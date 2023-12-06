import * as utils from '../utils.ts'
import * as messages from '../messages.ts'
import { ReadyState } from "../retransmitting-websocket/src/RetransmittingWebSocket.ts";

export const denoDeployBccSpeedLimit = 82; // Documentation says it is 64kB/s

const inboundChannel = new BroadcastChannel('portal_inbound');
const outboundChannel = new BroadcastChannel('portal_outbound');

const sendToAgent = utils.createRateLimiter<messages.BccMsg>(
	denoDeployBccSpeedLimit,
	messages.getEffectiveByteLength, 
	inboundChannel.postMessage.bind(inboundChannel));

/**
 * This endpoint simply sends the broadcasting message to the remote pair.
 * @param webSocket 
 */
export function handleBccWsForwarding(webSocket: WebSocket):void {
	if (webSocket.binaryType !== 'arraybuffer') {
		throw new Error('Only ArrayBuffer WebSockets are supported');
	}

	function handleA2OMessage(event: MessageEvent<messages.BccMsg>) {
		if (webSocket.readyState === ReadyState.CONNECTING || webSocket.readyState === ReadyState.OPEN) {
			const encodedMessage = messages.encodeBccMsg(event.data);
			webSocket.send(encodedMessage);	// encodedMessage will be buffered if WebSocket is CONNECTING.
		} else {
			// Underlying WebSocket is closed or closing
			// Discard the message
			utils.log("handleA2OMessage discard");
		}
	}

	webSocket.onopen = () => {
		utils.debug("Outlet online!");
		outboundChannel.addEventListener('message', handleA2OMessage);
	};

	webSocket.onclose = (event: CloseEvent) => {
		utils.debug("Outlet offline!");
		sendToAgent({
			type: messages.BccMsgType.MEDIUM_BREAK,
			id: 0,
			channelUUID: '',
			data: undefined,
		})
		outboundChannel.removeEventListener('message', handleA2OMessage);
	}

	webSocket.onmessage = (event: MessageEvent) => {
		const decodedMessage = messages.decodeBccMsg(new Uint8Array(event.data));
		sendToAgent(decodedMessage);
	}
}
