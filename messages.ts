import * as utils from './utils.ts'

export enum BccMsgOutboundType {
	PING = 0,
	NEW,
	DATA_OUTBOUND,
	CLOSE_OUTBOUND,
	CLOSED_OUTBOUND,
}

export enum BccMsgInboundType {
	PONG = 7,
	CREATED,
	DATA_INBOUND,
	CLOSED_INBOUND,
	CLOSE_INBOUND,
	MEDIUM_BREAK,
}

export type BccMsgType = BccMsgOutboundType | BccMsgInboundType;

/**
 * BroadcastChannelMessage
 */
export interface BccMsg {
	type: BccMsgOutboundType | BccMsgInboundType,
	channelUUID: string,
}

interface BccMsgWithData extends BccMsg {
	type: BccMsgOutboundType.NEW | BccMsgOutboundType.DATA_OUTBOUND | BccMsgInboundType.DATA_INBOUND
	data: ArrayBufferLike | string,
}

export interface BccMsgNew extends BccMsgWithData {
	type: BccMsgOutboundType.NEW,
	data: string,	// The URL
}

export interface BccMsgData extends BccMsgWithData {
	type: BccMsgOutboundType.DATA_OUTBOUND | BccMsgInboundType.DATA_INBOUND,
}

export interface BccMsgClose extends BccMsg {
	type: BccMsgOutboundType.CLOSE_OUTBOUND | BccMsgInboundType.CLOSE_INBOUND,
	code: number,
	reason: string,
}

function isMsgContainsData(message: BccMsg) {
	return message.type === BccMsgOutboundType.NEW ||
		message.type === BccMsgOutboundType.DATA_OUTBOUND ||
		message.type === BccMsgInboundType.DATA_INBOUND;
}

function isMsgClose(message: BccMsg) {
	return message.type === BccMsgOutboundType.CLOSE_OUTBOUND 
		|| message.type === BccMsgInboundType.CLOSE_INBOUND;
}

export type encodeWsDataResult = {
	encodedData: ArrayBufferLike,
	isTextMsg: boolean,
}

enum BccMsgPayloadType {
	BINARY_DATA = 0,
	UTF8_STRING,
}

function encodeWsData(data: ArrayBufferLike | string): encodeWsDataResult {
	let encodedData: ArrayBufferLike;
	let isTextMsg: boolean;

	if (typeof data === 'string') {
		const textEncoder = new TextEncoder();
		encodedData = textEncoder.encode(data).buffer;
		isTextMsg = true;
	} else {
		encodedData = data;
		isTextMsg = false;
	}

	return { encodedData, isTextMsg };
}

/**
 * Encode a BccMsg into a WebSocket message.
 * 
 * Format (ArrayBuffer):
 * 
 * Header:
 * 1. 1 byte of message type
 * 2. 16 bytes of uuid
 * 
 * New/Data Message:
 * 1. 1 byte of data type
 * 2. followed by data (Binary / UTF8 encoded string)
 * 
 * Close Message:
 * 1. 2 bytes of close code, big-endian
 * 2. followed by the close reason, a UTF8 encoded string
 * @param message 
 */
export function encodeBccMsg(message: BccMsg): Uint8Array {
	const type: number = message.type;
	const channelUUID = utils.uuidStrToBytes(message.channelUUID);
	// We simply drop the direction field

	let payloadType = BccMsgPayloadType.BINARY_DATA;
	let payload: ArrayBufferLike | null = null;
	let msgLength = 17;
	if (isMsgContainsData(message)) {
		const dataMsg = <BccMsgWithData> message;
		const encodedPayload = encodeWsData(dataMsg.data);
		payloadType = encodedPayload.isTextMsg ? BccMsgPayloadType.UTF8_STRING : BccMsgPayloadType.BINARY_DATA;
		payload = encodedPayload.encodedData;
		msgLength += 1 + payload.byteLength;
	} else if (isMsgClose(message)) {
		const closeMsg = <BccMsgClose> message;
		const textEncoder = new TextEncoder();
		payload = textEncoder.encode(closeMsg.reason).buffer;
		msgLength += 2 + payload.byteLength;
	}

	const buffer = new Uint8Array(msgLength);
	buffer[0] = type;
	buffer.set(new Uint8Array(channelUUID), 1);

	if (isMsgContainsData(message)) {
		buffer[17] = payloadType;
		if (payload != null) {
			buffer.set(new Uint8Array(payload), 18);
		}
	} else if (isMsgClose(message)) {
		const closeMsg = <BccMsgClose> message;
		buffer[17] = (closeMsg.code >> 8) & 0xFF;
		buffer[18] = closeMsg.code & 0xFF;
		if (payload != null) {
			buffer.set(new Uint8Array(payload), 19);
		}
	}
	return buffer;
}

export function decodeBccMsg(buffer: Uint8Array): BccMsg {
	const type:number = buffer[0];
	const bccMsg = {
		type,
		channelUUID: utils.uuidStrFromBytes(buffer, 1),
	}
	const payloadType: BccMsgPayloadType = buffer[17];

	if (isMsgContainsData(bccMsg)) {
		const dataMsg = <BccMsgWithData> bccMsg;
		switch (payloadType) {
			case BccMsgPayloadType.BINARY_DATA: {
				const payload = new Uint8Array(buffer.byteLength - 18);
				payload.set(buffer.slice(18), 0);
				dataMsg.data = payload;
				break;
			}

			case BccMsgPayloadType.UTF8_STRING: {
				const textDecoder = new TextDecoder();
				const text = textDecoder.decode(buffer.slice(18));
				dataMsg.data = text;
				break;
			}
		}
	} else if (isMsgClose(bccMsg)) {
		const closeMsg = <BccMsgClose> bccMsg;
		const textDecoder = new TextDecoder();
		closeMsg.code = buffer[17];
		closeMsg.code <<= 8;
		closeMsg.code |= buffer[18];
		closeMsg.reason = textDecoder.decode(buffer.slice(19));
	}

	return bccMsg;
}
