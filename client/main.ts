import { RetransmittingWebSocket } from '../retransmitting-websocket/src/RetransmittingWebSocket.ts'
import {
	PassiveLogicalWebSocket
} from './passivelws.ts'
import * as messages from '../messages.ts'
import * as utils from '../utils.ts'

const agentURL = Deno.env.get("AGENT_URL") || 'ws://localhost:8000/ws_out';
utils.log(`Agent URL is: ${agentURL}`);

const config = {
	defaultDestURL: 'default!!!',
	forceDefaultDestURL: false,
}

function getDestURL(destURL = '') {
	if (config.forceDefaultDestURL)
		return config.defaultDestURL;
	return destURL.length > 0 ? destURL : config.defaultDestURL;
}

function onChannelEstablish(lws: PassiveLogicalWebSocket, destURL: string) {
	lws.onopen = () => {
		utils.log(lws.channelUUID.substring(0, 4), 'Connecting to', destURL);

		try {
			const webSocket = new WebSocket(destURL);
			webSocket.binaryType = 'arraybuffer';

			// Echo back destURL to notify the pair that the WebSocket connection is ready.
			// Afterwards, the LWS channel becomes transparent.
			webSocket.onopen = () => {
				lws.send(destURL);
			}

			webSocket.onmessage = (event) => {
				lws.send(event.data);
			};
	
			webSocket.onclose = (event) => {
				utils.log(lws.channelUUID.substring(0, 4), 'Dest Closed!', event.code, event.reason);
				lws.close(event.code, event.reason);
			}

			lws.onmessage = (event) => {
				webSocket.send(event.data);	
			};
	
			lws.onclose = (event) => {
				const code = utils.canWebSocketReturn(event.code) ? event.code : 1000;
				utils.log(lws.channelUUID.substring(0, 4), 'LWS Closed with', code, event.reason);
				webSocket.close(code, event.reason);
			}
		} catch (error) {
			lws.close(1001, error.message || 'Unknown error happend while connecting to: ' + destURL);
		}
	}
}

function connectToAgent() {
	const webSocket = new WebSocket(agentURL);
	webSocket.binaryType = 'arraybuffer';

	const establishedChannels = new Map<string, PassiveLogicalWebSocket>;

	function sendBccMsg(message: messages.BccMsg) {
		messages.log('A<O', message);
		const encodedMsg = messages.encodeBccMsg(message);
		webSocket.send(encodedMsg);
	}

	function handleBccMsg(message: messages.BccMsg) {
		// Always handle Ping-Pong
		if (message.type === messages.BccMsgType.PING) {
			messages.createOrderedSender(sendBccMsg, utils.instanceUUID)(messages.BccMsgType.PONG, undefined);
			return;
		}

		if (message.type == messages.BccMsgType.NEW) {
			if (!(message.channelUUID in establishedChannels)) {
				const newChannel = new PassiveLogicalWebSocket(message.channelUUID, sendBccMsg);
				establishedChannels.set(message.channelUUID, newChannel);
				newChannel.addEventListener('close', (event) => {
					const channel:PassiveLogicalWebSocket  = event.target;
					establishedChannels.delete(channel.channelUUID);
				});

				const dataNew = messages.getBccMsgData<messages.BccMsgType.NEW>(message);
				const destURL = getDestURL(dataNew);
				onChannelEstablish(newChannel, destURL);
			}
		}

		const channel = establishedChannels.get(message.channelUUID);
		if (channel)
			channel.handleDisorderdBccMsg(message);
	}

	webSocket.onopen = () => {
		utils.log('Connected to agent!');
	}

	webSocket.onmessage = (event) => {
		const data: ArrayBuffer = event.data;
		const msg = messages.decodeBccMsg(new Uint8Array(data));
		messages.log('A>O', msg);
		handleBccMsg(msg);
	};

	webSocket.onclose = (event: CloseEvent) => {
		utils.log('Close:', event);

		for (const [channelUUID, channel] of establishedChannels) {
			channel.mediumBreak();
		}

		setTimeout(() => {
			connectToAgent();
		}, 500);
	}
}

connectToAgent();

/*
const robustWs = new RetransmittingWebSocket({
	// Maximum cummulative size of all received messages before we confirm reception.
	maxUnacknowledgedBufferSizeBytes: 100000,

	// Maximum cardinal size of all received messages before we confirm reception.
	maxUnacknowledgedMessages: 100,

	// Time after last messages before we confirm reception.
	maxUnacknowledgedTimeMs: 10000,

	// Maximum time after network failure before we consider the connection closed.
	closeTimeoutMs: 1500000,

	// Reconnection interval. Time to wait in milliseconds before trying to reconnect.
	reconnectIntervalMs: 3000,

	// Function to use for creating a new web socket when reconnecting.
	webSocketFactory: () => {
		const webSocket = new WebSocket(agentWsEndpoint);
		webSocket.binaryType = 'arraybuffer';
		return webSocket;
	}
});
*/