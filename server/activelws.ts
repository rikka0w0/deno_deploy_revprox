import {
	EventLike,
	MessageEventLike,
	ReadyState,
} from '../retransmitting-websocket/src/RetransmittingWebSocket.ts'

import * as messages from '../messages.ts'
import * as utils from '../utils.ts'
import {
	WebSocketBase
} from '../websocketbase.ts'

type ConfigType = {
	establishTimeoutMs: number,
	closeTimeoutMs: number,
}

// WebSocket API via BroadcastChannel tunnel
export class ActiveLogicalWebSocket extends WebSocketBase {
	public readonly channelUUID = crypto.randomUUID();
	private establishTimeoutTask?: ReturnType<typeof setTimeout>;

	private _config: ConfigType;
	private readonly orderedSend: messages.BccMsgSender;

	get config(): ConfigType {
		return this._config;
	}

	constructor(
		lowLevelSend: messages.BccMsgConsumer, 
		handlerAdder: (me: ActiveLogicalWebSocket, handler: messages.BccMsgConsumer) => void,
		destURL = ''
		) {
		super();

		this.orderedSend = messages.createOrderedSender(lowLevelSend, this.channelUUID);
		const onDisorderedMsgArrive = messages.createOrderedReceiver(this.handleBccMsg.bind(this), this.channelUUID);
		handlerAdder(this, onDisorderedMsgArrive);

		this._config = {
			establishTimeoutMs: 1000,
			closeTimeoutMs: 1000,
		}

		this.establishTimeoutTask = setTimeout(() => {
			utils.log('Unable to open a LogicalWebSocket, timeout!');
			this.establishTimeoutTask = undefined;
			this.closeInternal({
				type: 'close',
				code: 1002,
				reason: 'CONNECTING timeout',
				target: this,
				wasClean: false,
			});
		}, this.config.establishTimeoutMs);

		this.orderedSend(messages.BccMsgType.NEW, destURL);
	}

	close(code = 1000, reason = ''): void {
		if (this._readyState === ReadyState.CONNECTING || this._readyState === ReadyState.OPEN) {
			this.orderedSend(messages.BccMsgType.CLOSE_OUTBOUND, {code, reason});
		}

		super.close(code, reason);
	}

	send(dataBody: ArrayBufferLike | string): void {
		this.orderedSend(messages.BccMsgType.DATA_OUTBOUND, dataBody);
	}

	private handleBccMsg(message: messages.BccMsg) {
		switch (message.type) {
			case messages.BccMsgType.MEDIUM_BREAK:
				this.mediumBreak();
				return;

			case messages.BccMsgType.CREATED: {
				clearTimeout(this.establishTimeoutTask);
				this._readyState = ReadyState.OPEN;

				const wsEvent: EventLike = {
					type: 'open',
					target: this
				};
				this.triggerEvent(wsEvent);
				break;
			}

			case messages.BccMsgType.DATA_INBOUND: {
				const wsEvent: MessageEventLike = {
					type: 'message',
					target: this,
					data: messages.getBccMsgData<messages.BccMsgType.DATA_INBOUND>(message),
				};
				this.triggerEvent(wsEvent);
				break;
			}

			case messages.BccMsgType.CLOSE_INBOUND: {
				const closeMsg = messages.getBccMsgData<messages.BccMsgType.CLOSE_INBOUND>(message)
				this.orderedSend(messages.BccMsgType.CLOSED_OUTBOUND, undefined);

				this.closeInternal({
					type: 'close',
					code: closeMsg.code,
					reason: closeMsg.reason,
					target: this,
					wasClean: true,
				});
				break;
			}

			case messages.BccMsgType.CLOSED_INBOUND: {
				if (this.pendingCloseEvent)
					this.closeInternal(this.pendingCloseEvent);
				break;
			}
			default:
				break;
		}
	}
}
