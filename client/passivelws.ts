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
	public readonly channelUUID: string;
	private readonly orderedSend: messages.BccMsgSender;
	readonly handleDisorderdBccMsg: messages.BccMsgConsumer;


	constructor(channelUUID: string, lowLevelSend: messages.BccMsgConsumer) {
		super();
		this.channelUUID = channelUUID;
		this.handleDisorderdBccMsg = messages.createOrderedReceiver(this.handleBccMsg.bind(this), channelUUID);
		this.orderedSend = messages.createOrderedSender(lowLevelSend, channelUUID);
	}

	close(code = 1000, reason = ''): void {
		super.close(code, reason);

		this.orderedSend(messages.BccMsgType.CLOSE_INBOUND, {code, reason});
	}

	send(dataBody: ArrayBufferLike | string): void {
		this.orderedSend(messages.BccMsgType.DATA_INBOUND, dataBody);
	}

	private handleBccMsg(message: messages.BccMsg) {
		switch(message.type) {
			case messages.BccMsgType.NEW: {
				this.orderedSend(messages.BccMsgType.CREATED, undefined);
				this._readyState = ReadyState.OPEN;

				const wsEvent: EventLike = {
					type: 'open',
					target: this
				};
				this.triggerEvent(wsEvent);
				break;
			}

			case messages.BccMsgType.DATA_OUTBOUND: {
				const data = messages.getBccMsgData<messages.BccMsgType.DATA_OUTBOUND>(message);

				const wsEvent: MessageEventLike = {
					type: 'message',
					target: this,
					data,
				};
				this.triggerEvent(wsEvent);
				break;
			}

			case messages.BccMsgType.CLOSE_OUTBOUND: {
				const closeMsg = messages.getBccMsgData<messages.BccMsgType.CLOSE_OUTBOUND>(message);
				this.orderedSend(messages.BccMsgType.CLOSED_INBOUND, undefined);

				this.closeInternal({
					type: 'close',
					code: closeMsg.code,
					reason: closeMsg.reason,
					target: this,
					wasClean: true,
				});
				break;
			}

			case messages.BccMsgType.CLOSED_OUTBOUND: {
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