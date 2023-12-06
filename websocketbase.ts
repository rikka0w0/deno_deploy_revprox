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
} from './retransmitting-websocket/src/RetransmittingWebSocket.ts'

import * as utils from './utils.ts'

function callEventListener<T extends keyof WebSocketEventListenerMap>(
	event: WebSocketEventMap[T],
	listener: WebSocketEventListenerMap[T],
) {
	if ('handleEvent' in listener) {
		// @ts-ignore
		listener.handleEvent(event)
	} else {
		// @ts-ignore
		listener(event)
	}
}

// WebSocket API via BroadcastChannel tunnel
export abstract class WebSocketBase implements WebSocketLike {
	// The following properties are not implemented in a LogicalWebSocket.
	public readonly bufferedAmount = 0;
	public readonly extensions = '';
	public readonly protocol = '';
	public readonly url = '';

	// These exist so that casting a LogicalWebSocket to WebSocket is possible.
	public readonly CONNECTING = ReadyState.CONNECTING;
	public readonly OPEN = ReadyState.OPEN;
	public readonly CLOSING = ReadyState.CLOSING;
	public readonly CLOSED = ReadyState.CLOSED;

	/**
	* An event listener to be called when the WebSocket connection's readyState changes to CLOSED
	*/
	onclose: ((event: CloseEventLike) => void) | null = null
	/**
	* An event listener to be called when an error occurs
	*/
	onerror: ((event: ErrorEventLike) => void) | null = null
	/**
	* An event listener to be called when a message is received from the server
	*/
	onmessage: ((event: MessageEventLike) => void) | null = null
	/**
	* An event listener to be called when the WebSocket connection's readyState changes to OPEN;
	* this indicates that the connection is ready to send and receive data
	*/
	onopen: ((event: EventLike) => void) | null = null

	public readonly binaryType = 'arraybuffer';

	private listeners: ListenersMap = {
		error: [],
		message: [],
		open: [],
		close: [],
	};
	/**
	* The current state of the connection; this is one of the Ready state constants
	*/
	protected _readyState: ReadyState = ReadyState.CONNECTING;

	get readyState(): number {
		return this._readyState;
	}

	protected closedTimeoutTask?: ReturnType<typeof setTimeout>;
	protected pendingCloseEvent?: CloseEventLike
	protected pendingErrorEvent?: ErrorEventLike

	protected triggerEvent(event?: EventLike) {
		if (!event) {
			return;
		}

		switch (event.type) {
			case "open":
				if (this.onopen)
					this.onopen(event);
				this.listeners.open.forEach((listener) => callEventListener(event, listener))
				break;

			case "close": {
				const closeEvent = <CloseEventLike> event;
				if (this.onclose)
					this.onclose(closeEvent);
				this.listeners.close.forEach((listener) => callEventListener(closeEvent, listener))
				break;
			}

			case "error": {
				const errorEvent = <ErrorEventLike> event;
				if (this.onerror)
					this.onerror(errorEvent);
				this.listeners.close.forEach((listener) => callEventListener(errorEvent, listener))
				break;
			}

			case "message": {
				const msgEvent = <MessageEventLike> event;
				if (this.onmessage)
					this.onmessage(msgEvent);
				this.listeners.message.forEach((listener) => callEventListener(msgEvent, listener))
				break;
			}
		}
	}

	private cancelClosedTimeoutTask() {
		if (this.closedTimeoutTask) {
			clearTimeout(this.closedTimeoutTask)
			this.closedTimeoutTask = undefined
		}
	}

	protected closeInternal(event: CloseEventLike) {
		if (this.readyState === ReadyState.CLOSED) {
			return;
		}

		this.cancelClosedTimeoutTask();
		this._readyState = ReadyState.CLOSED;
		this.triggerEvent(this.pendingErrorEvent);
		this.triggerEvent(event);
	}

	protected ensureClosedTimeoutTask(event: CloseEventLike) {
		if (this._readyState === ReadyState.CLOSING || this._readyState === ReadyState.CLOSED || this.closedTimeoutTask) {
			return;
		}
		this.closedTimeoutTask = setTimeout(() => {
			utils.debug('closedTimeoutTask triggered!');
			this.closedTimeoutTask = undefined;
			this._readyState = ReadyState.CLOSING;
			this.closeInternal(event);
		}, this.config.closeTimeoutMs);
	}

	public mediumBreak(event: CloseEventLike = {
		type: 'close',
		code: 1001,
		reason: 'Underlying WebSocket and/or BroadcastChannel is broken',
		target: this,
		wasClean: false,
	}) {
		this.closeInternal(event);
	}

	abstract get config(): { closeTimeoutMs: number };

	abstract send(dataBody: ArrayBufferLike | string): void;
	close(code = 1000, reason = ''): void {
		this.pendingCloseEvent = {
			type: 'close',
			code,
			reason,
			target: this,
			wasClean: true,
		};

		this.ensureClosedTimeoutTask(this.pendingCloseEvent);
		this._readyState = ReadyState.CLOSING;
	}

	/**
	* Register an event handler of a specific event type
	*/
	public addEventListener<T extends keyof WebSocketEventListenerMap>(
		type: T,
		listener: WebSocketEventListenerMap[T],
	): void {
		if (this.listeners[type]) {
			// @ts-ignore
			this.listeners[type].push(listener);
		}
	}

	public dispatchEvent(event: EventLike): boolean {
		const listeners = this.listeners[event.type];
		if (listeners) {
			listeners.forEach((listener) => callEventListener(event, listener));
		}
		return true;
	}

	/**
	* Removes an event listener
	*/
	public removeEventListener<T extends keyof WebSocketEventListenerMap>(
		type: T,
		listener: WebSocketEventListenerMap[T],
	): void {
		if (this.listeners[type]) {
			// @ts-ignore
			this.listeners[type] = this.listeners[type].filter((l) => l !== listener);
		}
	}
}
