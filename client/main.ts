import { RetransmittingWebSocket } from '../retransmitting-websocket/src/RetransmittingWebSocket.ts'
import {
	PassiveLogicalWebSocket
} from './passivelws.ts'
import * as messages from '../messages.ts'
import * as utils from '../utils.ts'

const config = {
	defaultDestURL: 'default!!!',
	forceDefaultDestURL: false,
}

function getDestURL(destURL = '') {
	if (config.forceDefaultDestURL)
		return config.defaultDestURL;
	return destURL.length > 0 ? destURL : config.defaultDestURL;
}

function onChannelEstablish(lws: PassiveLogicalWebSocket) {
	lws.onopen = () => {
		utils.log(lws.channelUUID.substring(0, 4), 'Opened!');
	}

	lws.onmessage = (event) => {
		utils.log(lws.channelUUID.substring(0, 4), event.data);

		// Echo back
		lws.send(event.data);
	}

	lws.onclose = (event) => {
		utils.log(lws.channelUUID.substring(0, 4), 'Closed!', event.code, event.reason);
	}
}

function connectToAgent() {
	const webSocket = new WebSocket('ws://localhost:8000/ws_out');
	webSocket.binaryType = 'arraybuffer';

	const establishedChannels = new Map<string, PassiveLogicalWebSocket>;

	function sendBccMsg(message: messages.BccMsg) {
		const encodedMsg = messages.encodeBccMsg(message);
		webSocket.send(encodedMsg);
	}

	function handleBccMsg(message: messages.BccMsg) {
		// Always handle Ping-Pong
		if (message.type === messages.BccMsgOutboundType.PING) {
			sendBccMsg({
				type: messages.BccMsgInboundType.PONG,
				channelUUID: utils.instanceUUID,
			});
		}

		if (message.type == messages.BccMsgOutboundType.NEW) {
			if (!(message.channelUUID in establishedChannels)) {
				const newChannel = new PassiveLogicalWebSocket(message.channelUUID, sendBccMsg);
				establishedChannels.set(message.channelUUID, newChannel);
				newChannel.addEventListener('close', (event) => {
					const channel:PassiveLogicalWebSocket  = event.target;
					establishedChannels.delete(channel.channelUUID);
				});
				onChannelEstablish(newChannel);

				const msgNew = <messages.BccMsgNew> message;
				const destURL = getDestURL(msgNew.data);
				console.log("destURL = " + destURL);
			}
		}

		const channel = establishedChannels.get(message.channelUUID);
		if (channel)
			channel.handleBccMsg(message);
	}

	webSocket.onopen = () => {
		utils.log('Connected to agent!');
	}

	webSocket.onmessage = (event) => {
		const data: ArrayBuffer = event.data;
		const msg = messages.decodeBccMsg(new Uint8Array(data));
		utils.log(msg);
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