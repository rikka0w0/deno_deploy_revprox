import {
	ErrorEventLike,
	CloseEventLike,
	MessageEventLike,

	ListenersMap,

	ReadyState,
	RetransmittingWebSocketEventMap as WebSocketEventMap,
	WebSocketEventListenerMap,
	WebSocketLike,
	EventLike,
} from '../retransmitting-websocket/src/RetransmittingWebSocket.ts'

import * as messages from "../messages.ts";
import {
	WebSocketBase
} from '../websocketbase.ts'

export class PassiveLogicalWebSocket extends WebSocketBase {
	private _channelUUID;
	private replyBccMsg: (message: messages.BccMsg) => void;

	public get channelUUID() {
		return this._channelUUID;
	}

	constructor(channelUUID: string, replyBccMsg: (message: messages.BccMsg) => void) {
		super();
		this._channelUUID = channelUUID;
		this.replyBccMsg = replyBccMsg;
	}

	close(code = 1000, reason = ''): void {
		super.close(code, reason);

		const channelCloseMsg: messages.BccMsgInbound = {
			type: messages.BccMsgInboundType.CLOSE_INBOUND,
			channelUUID: this.channelUUID,
		}
		this.replyBccMsg(channelCloseMsg);
	}

	send(dataBody: ArrayBufferLike | string): void {
		this.replyBccMsg({
			type: messages.BccMsgInboundType.DATA_INBOUND,
			channelUUID: this.channelUUID,
			data: dataBody,
		} as messages.BccMsgDataInbound);
	}

	/**
	 * Only called by the underlying WebSocket!
	 * @param message 
	 */
	handleBccMsg(message: messages.BccMsg) {
		switch(message.type) {
			case messages.BccMsgOutboundType.NEW: {
				this.replyBccMsg({
					type: messages.BccMsgInboundType.CREATED,
					channelUUID: this.channelUUID,
				});
				this._readyState = ReadyState.OPEN;

				const wsEvent: EventLike = {
					type: 'open',
					target: this
				};
				this.triggerEvent(wsEvent);
				break;
			}

			case messages.BccMsgOutboundType.DATA_OUTBOUND: {
				const dataMsg = <messages.BccMsgDataOutbound> message;

				const wsEvent: MessageEventLike = {
					type: 'message',
					target: this,
					data: dataMsg.data,
				};
				this.triggerEvent(wsEvent);
				break;
			}

			case messages.BccMsgOutboundType.CLOSE_OUTBOUND: {
				this.replyBccMsg({
					type: messages.BccMsgInboundType.CLOSED_INBOUND,
					channelUUID: this.channelUUID,
				});

				this.closeInternal({
					type: 'close',
					code: 1000,
					reason: '',
					target: this,
					wasClean: true,
				});
				break;
			}

			case messages.BccMsgOutboundType.CLOSED_OUTBOUND: {
				if (this.pendingCloseEvent)
					this.closeInternal(this.pendingCloseEvent);
				break;
			}
		}
	}

	get config(): {
		closeTimeoutMs: number,
	} {
		return {
			closeTimeoutMs: 1000,
		};
	};
}