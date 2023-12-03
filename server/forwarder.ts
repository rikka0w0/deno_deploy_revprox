import * as utils from '../utils.ts'
import * as messages from '../messages.ts'
import { ReadyState } from "../retransmitting-websocket/src/RetransmittingWebSocket.ts";

const inboundChannel = new BroadcastChannel('portal_inbound');
const outboundChannel = new BroadcastChannel('portal_outbound');

new BroadcastChannel("portal_inbound").addEventListener('message', (event) => {
	utils.debug('A<O', event.data);
});
new BroadcastChannel("portal_outbound").addEventListener('message', (event) => {
	utils.debug('A>O', event.data);
});

function sendToAgent(message: messages.BccMsg) {
	inboundChannel.postMessage(message);
}

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
		}
	}

	webSocket.onopen = () => {
		utils.debug("Outlet online!");
		outboundChannel.addEventListener('message', handleA2OMessage);
	};

	webSocket.onclose = (event: CloseEvent) => {
		utils.debug("Outlet offline!");
		sendToAgent({
			type: messages.BccMsgInboundType.MEDIUM_BREAK,
			channelUUID: ''
		})
		outboundChannel.removeEventListener('message', handleA2OMessage);
	}

	webSocket.onmessage = (event: MessageEvent) => {
		const decodedMessage = messages.decodeBccMsg(new Uint8Array(event.data));
		sendToAgent(decodedMessage);
	}
}