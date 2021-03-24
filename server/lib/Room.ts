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
import {Peer} from './Peer';
import {lConfig} from '../config/config'
import {types as mediasoupTypes, getSupportedRtpCapabilities } from 'mediasoup';
import { RoomStatus, RequestMethod, WlClassroom } from './defines';
import { ClaRoom } from '../model/model';

import { getLogger } from 'log4js';
const logger = getLogger('Room');

let mediaCodecs = new Array<mediasoupTypes.RtpCodecCapability>();
getSupportedRtpCapabilities().codecs?.forEach(codec => {
	switch(codec.mimeType) {
		case 'video/H264':
		case 'video/VP8' :
		case 'video/VP9' :
		case 'audio/opus':
			mediaCodecs.push(codec);
	}
});

export class Room extends EventEmitter {
	//创建一个房间，实质是调用mediasoup在特定的worker上面创建了一个router
	static async create(mediasoupWorker: mediasoupTypes.Worker, roomId:string ) {
		logger.info('create() [roomId:"%s"]', roomId);

		const mediasoupRouter = await mediasoupWorker.createRouter({ mediaCodecs });
		return new Room(roomId, mediasoupRouter);
	}
	//客户端管理器
	public peers = new Map<string,Peer>();
  public closed = false;
  //房间db
  public roomdb: ClaRoom|undefined;
	private bornTime = Date.now();
	private activeTime = Date.now();
	private classroom = new WlClassroom();

	constructor(
		public id: string, 
		private mediasoupRouter: mediasoupTypes.Router, 
		){
		super();
		
		logger.info('constructor() [roomId:"%s"]', id);
    this.setMaxListeners(Infinity);
	//更新房间最近的活跃时间
    ClaRoom.findOne({id}).then(async (roomdb) => {
      this.roomdb = roomdb;
      if (this.roomdb) {
        this.roomdb.lastActiveTime = Date.now().toString();
        await this.roomdb.save();
      }
    })
	}

	//关闭端，然后关闭路由器，最后触发close事件
	public close() {
		logger.info('close() room: %s', this.id);
		this.closed = true;

		this.peers.forEach((peer) => {
			if (!peer.closed) {
				peer.close();
			}
		});

		this.peers.clear();
		this.mediasoupRouter.close();

		this.emit('close');
	}
	//处理一个端,把这个端加入房间内，并且监听端上发来的信息进行处理
	public handlePeer(peer: Peer) {
		logger.info('handlePeer() id: %s, address: %s', peer.id, peer.socket.handshake.address);
		//添加socket 进入到romm_id房间内
		peer.socket.join(this.id);
		//处理对端发来的消息
		this.setupSocketHandler(peer);
		//把对端加入到房间中
		this.peers.set(peer.id, peer);

		//监听，对端关闭事件，如果这个端进行了管理，那么在房间层级对这个端资源进行清理
		peer.on('close', () => {
			logger.info('%s closed, room:  %s', peer.id, this.id);
			//如果这个房间已经关闭了，那么直接返回
			if (this.closed) {
				return;
			}
			//在socektio房间内发送消息，说明对端已经关闭了
			this._notification(peer.socket, 'peerClosed', { peerId: peer.id }, true);

			this.peers.delete(peer.id);
			//检查这个房间是否为空，如果为空，那么关闭这个房间
			if (this.checkEmpty()) {
				this.close();
			}
		});
	}

	public setupSocketHandler(peer: Peer) {
		peer.socket.on('request', (request, cb) => {
			this.setActive();

			logger.debug(
				'Peer "request" event [room:"%s", method:"%s", peerId:"%s"]',
				this.id, request.method, peer.id);

			this._handleSocketRequest(peer, request, cb)
				.catch((error) => {
					logger.error('"request" failed [error:"%o"]', error);

					cb(error);
				});
		});
	}

	public getPeer(peerId: string ) {
		return this.peers.get(peerId);
	}

	statusReport() {
		const dura = Math.floor((Date.now() - this.bornTime) / 1000);
		const lastActive = Math.floor((Date.now() - this.activeTime) / 1000);

		return {
			id: this.id,
			peers: [...this.peers.keys()],
			duration: dura,
      lastActive,
      ...this.classroom,
		};
	}

	checkDeserted() {
		if (this.checkEmpty()) {
			logger.info('room %s is empty , now close it!', this.id);
			this.close();
			return;
		}

		const lastActive = (Date.now() - this.activeTime) / 1000; // seconds
		if ( lastActive > 2 * 60 * 60 ) { // 2 hours not active
			logger.warn('room %s too long no active!, now close it, lastActive: %s', this.id, lastActive);
			this.close();
		}
	}

	private setActive() {
		this.activeTime = Date.now();
	}

	private checkEmpty() {
		return this.peers.size === 0;
	}

	private stopClass(peer: Peer) {
		this.classroom.stopTime = Date.now();
		this.classroom.status = RoomStatus.stopped;

		this._notification(peer.socket, RequestMethod.classStop, {
			roomId : this.id
		}, true);
	}

	private async _handleSocketRequest(peer: Peer, request, cb) {
		switch (request.method) {
      case RequestMethod.getRouterRtpCapabilities:
			{
				cb(null, this.mediasoupRouter.rtpCapabilities);

				break;
			}
	
	//加入一个房间
      case RequestMethod.join:
			{
				const {
					roler,
					displayName,
					picture,
					platform,
					rtpCapabilities
				} = request.data;

				if ( peer.joined ) {
					cb(null , {joined: true});
					break;
				}
				//得到请求的信息
				peer.roler = roler;
				peer.displayName = displayName;
				peer.picture = picture;
				peer.platform = platform;
				peer.rtpCapabilities = rtpCapabilities;

				const peerInfos = new Array<any>();

				this.peers.forEach((joinedPeer) => {
					peerInfos.push(joinedPeer.peerInfo());

					joinedPeer.producers.forEach((producer) => {
						this._createConsumer(peer, joinedPeer, producer);
					});
				});

				cb(null, { peers: peerInfos, joined: false });

				this._notification(
					peer.socket,
					'newPeer',
					{...peer.peerInfo()},
					true
				);

				logger.debug(
					'peer joined [peer: "%s", displayName: "%s", picture: "%s", roler:"%s", platform: "%s"]',
					peer.id, displayName, picture, roler, platform);

				peer.joined = true;
				break;
			}

      case RequestMethod.createWebRtcTransport:
			{
				//参数，是否强制使用Tcp, 生产者，消费者
				const { forceTcp, producing, consuming } = request.data;
				const {
					maxIncomingBitrate,
					initialAvailableOutgoingBitrate
				} = lConfig.webRtcTransport;
				
				//创建一个webrtc通道
				const transport = await this.mediasoupRouter.createWebRtcTransport({
						listenIps : lConfig.webRtcTransport.listenIps,
						enableUdp : !forceTcp,
						enableTcp : true,
						preferUdp : true,
						initialAvailableOutgoingBitrate,
						appData   : { producing, consuming }
					});
				//给peer添加上一个通道
				peer.addTransport(transport.id, transport);

				cb(
					null,
					{
						id             : transport.id,
						iceParameters  : transport.iceParameters,
						iceCandidates  : transport.iceCandidates,
						dtlsParameters : transport.dtlsParameters
					});

				if (maxIncomingBitrate)
				{
					try { await transport.setMaxIncomingBitrate(maxIncomingBitrate); }
					catch (error) {}
				}

				break;
			}
	 //连接一个webrtcTransport通道
      case RequestMethod.connectWebRtcTransport:
			{
				const { transportId, dtlsParameters } = request.data;
				const transport = peer.getTransport(transportId);
				//根据通道id得到得到通道，然后使用这个通道连接dtlsParamters
				if (!transport)
					throw new Error(`transport with id "${transportId}" not found`);

				await transport.connect({ dtlsParameters });

				cb();

				break;
			}
	 //重新连接ICE
      case RequestMethod.restartIce:
			{
				//通道id
				const { transportId } = request.data;
				const transport = peer.getTransport(transportId);

				if (!transport) {
					throw new Error(`transport with id "${transportId}" not found`);
				}
				//
				const iceParameters = await transport.restartIce();

				cb(null, { iceParameters });

				break;
			}
	 
	 //生产者
      case RequestMethod.produce:
			{
				const { transportId, kind, rtpParameters } = request.data;
				let { appData } = request.data;
				const transport = peer.getTransport(transportId);

				if (!transport) {
					logger.error(`transport with id "${transportId}" not found`);
					cb();
					break;
				}

				appData = { ...appData, peerId: peer.id };

				const producer = await transport.produce({ kind, rtpParameters, appData });
				peer.addProducer(producer.id, producer);

				producer.on('videoorientationchange', (videoOrientation) => {
					logger.debug(
						'producer "videoorientationchange" event [producerId:"%s", videoOrientation:"%o"]',
						producer.id, videoOrientation);
				});

				logger.info('produce, peer: %s, producerId: %s', peer.id, producer.id);
				cb(null, { id: producer.id });

				//每一个对端都要加入到这个生产者中
				this.peers.forEach((otherPeer) => {
					this._createConsumer(otherPeer, peer, producer);
				});

				break;
			}
	   //关闭生产者
      case RequestMethod.closeProducer:
			{
				const { producerId } = request.data;
				const producer = peer.getProducer(producerId);

				if (!producer) {
					logger.error(`producer with id "${producerId}" not found`);
					cb();
					break;
				}

				logger.info('closeProducer, peer: %s, producerId: %s', peer.id, producer.id);
				//关闭生产者，移除生产者
				producer.close();
				peer.removeProducer(producer.id);
				cb();
				break;
			}
	  //禁用生产者
      case RequestMethod.pauseProducer:
			{
				const { producerId } = request.data;
				const producer = peer.getProducer(producerId);

				if (!producer) {
					throw new Error(`producer with id "${producerId}" not found`);
				}

				await producer.pause();
				cb();
				break;
			}
      //重试生产者
      case RequestMethod.resumeProducer:
			{
				const { producerId } = request.data;
				const producer = peer.getProducer(producerId);

				if (!producer)
					throw new Error(`producer with id "${producerId}" not found`);

				await producer.resume();

				cb();

				break;
			}
	  //禁用消费者
      case RequestMethod.pauseConsumer:
			{
				const { consumerId } = request.data;
				const consumer = peer.getConsumer(consumerId);

				if (!consumer)
					throw new Error(`consumer with id "${consumerId}" not found`);

				await consumer.pause();

				cb();

				break;
			}

      case RequestMethod.resumeConsumer:
			{
				const { consumerId } = request.data;
				const consumer = peer.getConsumer(consumerId);

				if (!consumer)
					throw new Error(`consumer with id "${consumerId}" not found`);

				await consumer.resume();

				cb();

				break;
			}
      //请求消费一个关键帧
      case RequestMethod.requestConsumerKeyFrame:
			{
				const { consumerId } = request.data;
				const consumer = peer.getConsumer(consumerId);

				if (!consumer)
					throw new Error(`consumer with id "${consumerId}" not found`);

				await consumer.requestKeyFrame();

				cb();

				break;
			}
      //得到生产者的状态
      case RequestMethod.getProducerStats:
			{
				const { producerId } = request.data;
				const producer = peer.getProducer(producerId);

				if (!producer) {
					logger.error(`producer with id "${producerId}" not found`);
					cb(null, {closed: true});
				} else {
					const stats = await producer.getStats();
					cb(null, {closed: producer.closed, stats});
				}

				break;
			}

      case RequestMethod.getTransportStats:
			{
				const { transportId } = request.data;
				const transport = peer.getTransport(transportId);

				if (!transport) {
					logger.warn('Do not find transport: %s', transportId);
					cb(null, {closed: true});
				} else {
					const stats = await transport.getStats();
					cb(null, {closed:transport.closed, stats});
				}

				break;
			}

      case RequestMethod.getConsumerStats:
			{
				const { consumerId } = request.data;
				const consumer = peer.getConsumer(consumerId);

				if (!consumer) {
					logger.error(`consumer with id "${consumerId}" not found`);
					cb(null, {closed: true});
				} else {
					const stats = await consumer.getStats();
					cb(null, {closed: consumer.closed, stats});
				}

				break;
			}

      case RequestMethod.closePeer:
			{
				const { stopClass } = request.data;
				logger.info('closePeer, peer: %s, stopClass: %s', peer.id, stopClass);

				cb();

				peer.close();

				if ( stopClass ) {
					this.stopClass(peer);
				}
				break;
			}

      case RequestMethod.chatMessage:
			{
        const { to } = request.data;
        if (to === 'all') {
				  this._notification(peer.socket, RequestMethod.chatMessage, request.data, true);
        } else {
          const toPeer = this.getPeer(to);
          if (toPeer) {
            this._notification(toPeer.socket, RequestMethod.chatMessage, request.data, false);
          }
        }
				cb();

				break;
			}

      case RequestMethod.syncDocInfo:
			{
				const { info } = request.data;	
				this._notification(peer.socket, RequestMethod.syncDocInfo,{
					peerId	: peer.id,
					info
				}, true);

				cb();
				break;
			}

      case RequestMethod.classStart:
			{
				const { roomId } = request.data;
				this.classroom.startTime = Date.now();
				this.classroom.status = RoomStatus.started;

				this._notification(peer.socket, RequestMethod.classStart, {
					roomId
				}, true);

				cb();
				break;
			}

      case RequestMethod.classStop:
			{
				this.stopClass(peer);

				cb();
				break;
			}

      case RequestMethod.roomInfo:
			{
				cb(null, this.classroom);
				break;
			}

      case  RequestMethod.changeRoler:
      {
        const { roler } = request.data;
        peer.roler = roler;

        this._notification(peer.socket, RequestMethod.changeRoler, request.data, true);
        cb();
        break;
      }

      case RequestMethod.connectVideo:
			{
				this._notification(peer.socket, RequestMethod.connectVideo, {
					peerId: peer.id
				}, true);

				cb();
				break;
			}

      case RequestMethod.disconnectVideo:
			{
				const { toPeer } = request.data;

				this._notification(peer.socket, RequestMethod.disconnectVideo, {
					toPeer
				}, true);

				cb();
				break;
			}

      case RequestMethod.connectApproval:
			{
				const { toPeer, approval } = request.data;

				this._notification(peer.socket, RequestMethod.connectApproval, {
					peerId: peer.id,
					toPeer,
					approval,
				}, true);

				cb();
				break;
			}

      case RequestMethod.switchComponent:
			{
				this._notification(peer.socket, RequestMethod.switchComponent, request.data, true);
				cb();
				break;
      }
      
      case RequestMethod.muted: 
      {
        const { to, kind } = request.data;
        if (to === 'all') {
          if (kind === 'audio') {
            this.classroom.mutedAudio = true;
          } else {
            this.classroom.mutedVideo = true;
          }

				  this._notification(peer.socket, RequestMethod.muted, request.data, true);
        } else {
          const toPeer = this.getPeer(to);
          if (toPeer) {
            this._notification(toPeer.socket, RequestMethod.muted, request.data, false);
          }
        }
        cb();
        break;
      }

      case RequestMethod.unmuted: 
      {
        const { to, kind } = request.data;
        if (to === 'all') {
          if (kind === 'audio') {
            this.classroom.mutedAudio = false;
          } else {
            this.classroom.mutedVideo = false;
          }

				  this._notification(peer.socket, RequestMethod.unmuted, request.data, true);
        } else {
          const toPeer = this.getPeer(to);
          if (toPeer) {
            this._notification(toPeer.socket, RequestMethod.unmuted, request.data, false);
          }
        }

        cb();
        break;
      }

			default: 
			{
				logger.error('unknown request.method "%s"', request.method);
				cb(500, `unknown request.method "${request.method}"`);
			}
		}
	}

	async _createConsumer(consumerPeer: Peer, producerPeer: Peer, producer: mediasoupTypes.Producer) {
		//创建消费者
		logger.debug(
			'_createConsumer() [consumerPeer:"%s", producerPeer:"%s", producer:"%s"]',
			consumerPeer.id,
			producerPeer.id,
			producer.id
		);
		//如果消费者不能消费生产者的数据，那么直接返回
		if (!consumerPeer.rtpCapabilities ||
			!this.mediasoupRouter.canConsume({
					producerId      : producer.id,
					rtpCapabilities : consumerPeer.rtpCapabilities
				})
		){
			return;
		}

		//得到消费者的流通道
		// Must take the Transport the remote Peer is using for consuming.
		const transport = consumerPeer.getConsumerTransport();
		//如果没有通道，返回
		if (!transport) {
			logger.warn('_createConsumer() | Transport for consuming not found');

			return;
		}

		let consumer: mediasoupTypes.Consumer;

		try {
			//在通道上创建一个消费者,消费生产者
			consumer = await transport.consume({
					producerId      : producer.id,
					rtpCapabilities : consumerPeer.rtpCapabilities,
					paused          : producer.kind === 'video'
				});
		} catch (error) {
			logger.warn('_createConsumer() | [error:"%o"]', error);

			return;
		}

		//消费者本体添加上这个消费者
		consumerPeer.addConsumer(consumer.id, consumer);

		//给消费者注册监听事件, 如果通道管理，那么就移除这个消费者
		consumer.on('transportclose', () => {
			consumerPeer.removeConsumer(consumer.id);
		});

		//如果生产者关闭，那么移除消费者，并且通知关键内的所有人，有一个socket的消费者关闭了
		consumer.on('producerclose', () => {
			consumerPeer.removeConsumer(consumer.id);
			this._notification(consumerPeer.socket, 'consumerClosed', { consumerId: consumer.id });
		});

		//如果生产者暂停，那么通知房间内的所有socket, 说明消费者需要暂停
		consumer.on('producerpause', () => {
			this._notification(consumerPeer.socket, 'consumerPaused', { consumerId: consumer.id });
		});

		//如果生产者重新开始了,通知消费者要重新开始
		consumer.on('producerresume', () =>
		{
			this._notification(consumerPeer.socket, 'consumerResumed', { consumerId: consumer.id });
		});

		consumer.on('score', (score) => {
			this._notification(consumerPeer.socket, 'consumerScore', { consumerId: consumer.id, score });
		});

		consumer.appData.intervalHandler = setInterval(() => {
			this._notification(consumerPeer.socket, 'consumerScore', { consumerId: consumer.id, score: consumer.score });
		}, 60000);

		consumer.on('layerschange', (layers) =>
		{
			this._notification(
				consumerPeer.socket,
				'consumerLayersChanged',
				{
					consumerId    : consumer.id,
					spatialLayer  : layers ? layers.spatialLayer : null,
					temporalLayer : layers ? layers.temporalLayer : null
				}
			);
		});

		try
		{
			await this._request(
				consumerPeer.socket,
				'newConsumer',
				{
					peerId         : producerPeer.id,
					kind           : producer.kind,
					producerId     : producer.id,
					id             : consumer.id,
					rtpParameters  : consumer.rtpParameters,
					type           : consumer.type,
					appData        : producer.appData,
					producerPaused : consumer.producerPaused
				}
			);

			if (producer.kind === 'video') {
				await consumer.resume();
			}

			this._notification(
				consumerPeer.socket,
				'consumerScore',
				{
					consumerId : consumer.id,
					score      : consumer.score
				}
			);
		}
		catch (error) {
			logger.warn('_createConsumer() | [error:"%o"]', error);
		}
	}

	_timeoutCallback(callback) {
		let called = false;

		const interval = setTimeout(() => {
				if (called) {
					return;
				}

				called = true;
				callback(new Error('Request timeout.'));
			},
			10000
		);

		return (...args) => {
			if (called) {
				return;
			}

			called = true;
			clearTimeout(interval);

			callback(...args);
		};
	}

	_request(socket: SocketIO.Socket, method: string, data = {}) {
		return new Promise((resolve, reject) => {
			socket.emit(
				'request',
				{ method, data },
				this._timeoutCallback((err, response) => {
					if (err) {
						reject(err);
					}
					else {
						resolve(response);
					}
				})
			);
		});
	}

	_notification(socket, method, data = {}, broadcast = false) {
		if (broadcast) {
			socket.broadcast.to(this.id).emit(
				'notification', { method, data }
			);
		}
		else {
			socket.emit('notification', { method, data });
		}
	}
}
