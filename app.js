import express from "express";
import { Server } from "socket.io";
import http from "http";
import fs from "fs";
import path from "path";
import mediasoup, { getSupportedRtpCapabilities } from 'mediasoup';

const __dirname = path.resolve();
const app = express();

app.get('/', (req, res) => {
    res.send("Hello from Mediasoup app!");
});

app.use("/sfu", express.static(path.join(__dirname, "public")));

// 서버, mediasoup 설정
const httpServer = http.createServer(app);
httpServer.listen(3000, () => {
    console.log("Listening on port: http://localhost:3000");
});

const io = new Server(httpServer);
const peers = io.of("/mediasoup");

let worker;
let router;
let producerTransport;
let consumerTransport;
let producer;
let consumer;

// Worker 생성 함수
const createWorker = async () => {
    worker = await mediasoup.createWorker({
        rtcMinPort: 2000,
        rtcMaxPort: 3000,
    })
    console.log(`worker pid ${worker.pid}`);

    worker.on("died", error => {
        console.error("mediasoup worker has died");
        setTimeout(() => process.exit(1), 2000);
    })
    return worker;
}
// mediasoup worker 생성
worker = createWorker();

// 사용할 오디오 및 비디오 코덱 정의
const mediaCodecs = [
    {
        kind: "audio",
        mimeType: "audio/opus",
        clockRate: 48000,
        channels: 2,
    },
    {
        kind: "video",
        mimeType: "video/VP8",
        clockRate: 90000,
        parameters: {
            "x-google-start-bitrate": 1000,
        },
    },
];

// peers 객체에서 소켓을 이용한 이벤트 처리
peers.on("connection", async socket => {
    console.log(socket.id);
    socket.emit("connection-success", {
        socketId: socket.id,
        existsProducer: producer ? true : false,
    });

    socket.on("disconnect", () => {
        console.log("peer disconnected");
    });

    socket.on("createRoom", async (callback) => {
        if (router === undefined) {
            router = await worker.createRouter({ mediaCodecs, });
            console.log(`Router ID: ${router.id}`);
        }

        getRtpCapabilities(callback);
    })

    const getRtpCapabilities = (callback) => {
        const rtpCapabilities = router.rtpCapabilities;

        callback({ rtpCapabilities });
    }

    // 사전에 정의된 mediaCodes를 바탕으로 router 생성
    // router = await worker.createRouter({ mediaCodecs });

    // socket.on("getRtpCapabilities", (callback) => {
    //     const rtpCapabilities = router.rtpCapabilities;
    //     console.log("rtp Capabilities", rtpCapabilities);

    //     callback({ rtpCapabilities });
    // })

    // transport 생성
    socket.on("createWebRtcTransport", async ({ sender }, callback) => {
        console.log(`Is this a sender request? ${sender}`);
        if (sender) {
            producerTransport = await createWebRtcTransport(callback);
        } else {
            consumerTransport = await createWebRtcTransport(callback);
        }
    })
    // 만들어진 transport 연결
    socket.on("transport-connect", async ({ dtlsParameters}) => {
        console.log("DTLS PARAMS...", { dtlsParameters });
        await producerTransport.connect({ dtlsParameters });
    })

    // 
    socket.on("transport-produce", async ({ kind, rtpParameters, appData }, callback) => {
        producer = await producerTransport.produce({
            kind,
            rtpParameters,
        })

        console.log("Producer ID: ", producer.id, producer.kind)

        producer.on("transportclose", () => {
            console.log("transport for this producer closed");
            producer.close();
        })

        callback({
            id: producer.id
        })
    })

    socket.on("transport-recv-connect", async ({ dtlsParameters }) => {
        console.log(`DTLS PARAMS: ${dtlsParameters}`);
        await consumerTransport.connect({ dtlsParameters });
    });

    socket.on("consume", async ({ rtpCapabilities }, callback) => {
        try {
            if (router.canConsume({
                producerId: producer.id,
                rtpCapabilities
            })) {
                consumer = await consumerTransport.consume({
                    producerId: producer.id,
                    rtpCapabilities,
                    paused: true,
                })

                consumer.on("transportclose", () => {
                    console.log("transport close from consumer");
                })
                consumer.on("producerclose", () => {
                    console.log("producer of consumer closed");
                })

                const params = {
                    id: consumer.id,
                    producerId: producer.id,
                    kind: consumer.kind,
                    rtpParameters: consumer.rtpParameters,
                }

                callback({params});
            }
        } catch (error) {
            console.log(error.message);
            callback({
                params: {
                    error: error
                }
            })
        }
    })

    socket.on("consumer-resume", async () => {
        console.log("consumer resume");
        await consumer.resume();
    })
});

const createWebRtcTransport = async (callback) => {
    try {
        const webRtcTransport_options = {
            listenIps: [
                {
                    ip: '0.0.0.0', // replace with relevant IP address
                    announcedIp: '127.0.0.1',
                }
            ],
            enableUdp: true,
            enableTcp: true,
            preferUdp: true,
        }
        // router 내장함수 createWebRtpTransport 함수를 실행
        let transport = await router.createWebRtcTransport(webRtcTransport_options);
        console.log(`transport id: ${transport.id}`);

        // transport 객체에 이벤트 핸들러 부착
        transport.on("dtlsstatechange", dtlsState => {
            if (dtlsState === "closed") {
                transport.close();
            }
        });

        transport.on("close", () => {
            console.log("transport closed");
        });

        callback({
            params: {
                id: transport.id,
                iceParameters: transport.iceParameters,
                iceCandidates: transport.iceCandidates,
                dtlsParameters: transport.dtlsParameters,
            }
        })
        return transport;
    } catch (error) {
        console.log(error);
        callback({
            params: {
                error: error
            }
        })
    }
}