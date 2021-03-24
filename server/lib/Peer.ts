/*
 * Copyright (c) 2020 liwei<linewei@gmail.com>
 *
 * This program is free software: you can use, redistribute, and/or modify
 * it under the terms of the GNU Affero General Public License, version 3
 * or later ("AGPL"), as published by the Free Software Foundation.
 *
 * This program is distributed in the hope that it will be useful, but WITHOUT
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or
 * FITNESS FOR A PARTICULAR PURPOSE.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <http://www.gnu.org/licenses/>.
 */
import { EventEmitter } from 'events';
import * as socketio from 'socket.io';

import { getLogger } from 'log4js';
const logger = getLogger('Peer');

import { ROLE } from './defines';
import {types as mediasoupTypes} from 'mediasoup';
import {Room} from './Room';

//对端上的抽象，对通道，生产者，消费者进行管理
export class Peer extends EventEmitter {
	roler: ROLE;
	producers =  new Map<string, mediasoupTypes.Producer>();
	transports = new Map<string, mediasoupTypes.WebRtcTransport>();
	consumers = new Map<string, mediasoupTypes.Consumer>();
	closed = false;
	joined = false;
	displayName: string;
	picture: string;
	platform: string;
	address: string;
	enterTime = Date.now();

	disconnectCheck = 0;
	intervalHandler;

	rtpCapabilities: mediasoupTypes.RtpCapabilities;

	constructor(
		public id: string, 
		public socket: socketio.Socket,
		public room: Room) {

		super();

		logger.info('constructor() [id:"%s", socket:"%s"]', id, socket.id);

		this.address = socket.handshake.address;
		this.setMaxListeners(Infinity);
		this.handlePeer();
	}
    //关闭连接，触发close事件
	close() {
		logger.info('peer %s call close()', this.id);

		this.closed = true;
		this.closeResource();

		if (this.socket){
			this.socket.disconnect(true);
		}

		if ( this.intervalHandler ) {
			clearInterval(this.intervalHandler);
		}
		this.emit('close');
	}
    //处理重新连接
	public handlePeerReconnect(socket: socketio.Socket) {
		this.socket.leave(this.room.id);
		this.socket.disconnect(true);
		logger.info('peer %s reconnnected! disconnect previous connection now.', this.id);

		this.socket = socket;
		this.socket.join(this.room.id);
		this.room.setupSocketHandler(this);
		this.handlePeer();
	}
    //关闭连接资源
	private closeResource() {
		this.producers.forEach((producer) => {
			producer.close();
		});

		this.consumers.forEach((consumer) => {
			clearInterval(consumer.appData.intervalHandler);
			consumer.close();
		});

		this.transports.forEach((transport) => {
			transport.close();
		});

		this.transports.clear();
		this.producers.clear();
		this.consumers.clear();
	}
    //处理这个连接，监听disconnect, 如果端上发起disconnect,那么就关闭连接
	private handlePeer() {
		this.socket.on('disconnect', (reason) => {
			if (this.closed) {
				return;
			}
			logger.debug('"socket disconnect" event [id:%s], reason: %s', this.id, reason);


			this.disconnectCheck = 0;
			if ( this.intervalHandler ) {
				clearInterval(this.intervalHandler);
			}

			this.intervalHandler = setInterval(() => {
				this.checkClose();
			}, 20000);
		});

		this.socket.on('error', (error) => {
			logger.info('socket error, peer: %s, error: %s', this.id, error);
		});
	}
    
	//检查端是否关闭, 如果没有连接，具有6次等待的机会，如果等待6次还是没有不处于连接状态，那么久关闭连接
	public checkClose() {
		if (!this.socket.connected) {
			this.disconnectCheck++;
		} else {
			clearInterval(this.intervalHandler);
			this.intervalHandler = null;
		}

		if ( this.disconnectCheck > 6 ) {
			this.close();
		}
	}
	//添加一个通道
	addTransport(id: string, transport: mediasoupTypes.WebRtcTransport) {
		this.transports.set(id, transport);
	}
	//得到一个通道
	getTransport(id: string) {
		return this.transports.get(id);
	}
	//得到消费者通道
	getConsumerTransport() {
		return Array.from(this.transports.values())
			.find((t: any) => t.appData.consuming);
	}
    //移除一个通道
	removeTransport(id: string) {
		this.transports.delete(id);
	}
    //添加一个生产者
	addProducer(id: string, producer: mediasoupTypes.Producer) {
		this.producers.set(id, producer);
	}

	getProducer(id: string) {
		return this.producers.get(id);
	}

	removeProducer(id: string) {
		this.producers.delete(id);
	}

	addConsumer(id: string, consumer: mediasoupTypes.Consumer) {
		this.consumers.set(id, consumer);
	}

	getConsumer(id: string) {
		return this.consumers.get(id);
	}

	removeConsumer(id: string) {
		const consumer = this.consumers.get(id);
		if ( consumer ) {
			consumer.close();
			clearInterval(consumer.appData.intervalHandler);
		}
		this.consumers.delete(id);
	}
    //状态报告
	statusReport() {
		//通道报告
		let transportReport = new Array<any>();
		this.transports.forEach(value => {
			transportReport.push({
				transportId: value.id,
				closed: value.closed,
			});
		});
        //生产者报告
		let producerReport = new Array<any>();
		this.producers.forEach(value => {
			producerReport.push({
				producerId: value.id,
				closed: value.closed,
				kind: value.kind,
				type: value.type,
			});
		});
        //消费者报告
		let consumerReport = new Array<any>();
		this.consumers.forEach(value => {
			consumerReport.push({
				consumerId: value.id,
				closed: value.closed,
				kind: value.kind,
				producerId: value.producerId,
				type: value.type,
			});
		});
		return {
			...this.peerInfo(),
			joined: this.joined,
			closed: this.closed,
			transports: transportReport,
			producers: producerReport,
			consumers: consumerReport,
		};
	}
	//一个端上的信息
	peerInfo() {
		const peerInfo = {
			id          : this.id,
			roler		: this.roler,
			displayName : this.displayName,
			picture     : this.picture,
			platform	: this.platform,
			address		: this.address,
			durationTime	: (Date.now() -  this.enterTime) / 1000,
		};

		return peerInfo;
	}
}
