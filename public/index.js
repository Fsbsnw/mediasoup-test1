const io = require("socket.io-client");
const mediasoupClient = require('mediasoup-client');
const socket = io("/mediasoup");

socket.on("connection-success", ({socketId, existsProducer}) => {
    console.log(socketId, existsProducer);
})

let device;
let rtpCapabilities;
let producerTransport;
let consumerTransport;
let producer;
let consumer;
let isProducer = false;

let params = {
    encoding: [
        {
            rid: "r0",
            maxBitrate: 100000,
            scalabilityMode: "S1T3",
        },
        {
            rid: "r1",
            maxBitrate: 300000,
            scalabilityMode: "S1T3",
        },
        {
            rid: "r2",
            maxBitrate: 900000,
            scalabilityMode: "S1T3",
        },
    ],
    codecOptions: {
        videoGoogleStartBitrate: 1000
    }
}


const streamSuccess = (stream) => {
    localVideo.srcObject = stream;
    const track = stream.getVideoTracks()[0]
    params = {
        track,
        ...params
    }

    goConnect(true);
}


const getLocalStream = () => {
    navigator.mediaDevices.getUserMedia({
        audio: true,
        video: {
            width: {
                min: 640,
                max: 1920,
            },
            heigh: {
                min: 400,
                max: 1080,
            }
        }
    })
        .then(streamSuccess)
        .catch(error => {
        console.log(error.message);
    });
}

const goConsume = () => {
    goConnect(false)
}

const goConnect = (producerOrConsumer) => {
    isProducer = producerOrConsumer
    device === undefined ? getRtpCapabilities() : goCreateTransport()
}


const goCreateTransport = () => {
    isProducer ? createSendTransport() : createRecvTransport();
}

const createDevice = async () => {
    try {
        device = new mediasoupClient.Device();

        await device.load({
            routerRtpCapabilities: rtpCapabilities
        });

        console.log("Device RTP Capabilities", device.rtpCapabilities);

        goCreateTransport();
    } catch (error) {
        console.log(error);
        if (error.name === "UnsupportedError")
            console.warn("browser not supported");
    }
}

const getRtpCapabilities = () => {
    socket.emit("createRoom", (data) => {
        console.log(`Router RTP Capabilities... ${data.rtpCapabilities}`);

        rtpCapabilities = data.rtpCapabilities;

        createDevice();
    });
}

const createSendTransport = () => {
    socket.emit("createWebRtcTransport", { sender: true }, ({ params }) => {
        if (params.error) {
            console.log(params.error);
            return;
        }

        console.log(params);

        producerTransport = device.createSendTransport(params);
        producerTransport.on("connect", async ({ dtlsParameters }, callback, errback) => {
            try {
                await socket.emit("transport-connect", {
                    // transportId: producerTransport.id,
                    dtlsParameters: dtlsParameters,
                })

                callback();
            } catch (error) {
                errback(error);
            }
        })

        producerTransport.on("produce", async (parameters, callback, errback) => {
            console.log(parameters);

            try {
                await socket.emit("transport-produce", {
                    // transportId: producerTransport.id,
                    kind: parameters.kind,
                    rtpParameters: parameters.rtpParameters,
                    appData: parameters.appData,
                }, ({ id }) => {
                    callback({ id });
                })
            } catch (error) {
                errback(error);
            }
        })

        connectSendTransport();
    })


}

const connectSendTransport = async () => {
    producer = await producerTransport.produce(params);

    producer.on("trackended", () => {
        console.log("track ended");
    })

    producer.on("transportclose", () => {
        console.log("transport ended");
    })
}

const createRecvTransport = async () => {
    await socket.emit("createWebRtcTransport", { sender: false }, ({ params }) => {
        if (params.error) {
            console.log(params.error)
            return;
        }

        console.log(params);

        consumerTransport = device.createRecvTransport(params);

        consumerTransport.on("connect", async ({ dtlsParameters }, callback, errback) => {
            try {
                await socket.emit("transport-recv-connect", {
                    // transportId: consumerTransport.id,
                    dtlsParameters,
                })
                callback();
            } catch (error) {
                errback(error);
            }
        })

        connectRecvTransport();
    })
}

const connectRecvTransport = async () => {
    await socket.emit("consume", {
        rtpCapabilities: device.rtpCapabilities,
    }, async ({ params }) => {
        if (params.error) {
            console.log("Cannot Consume");
            return;
        }
        console.log(params);
        consumer = await consumerTransport.consume({
            id: params.id,
            producerId: params.producerId,
            kind: params.kind,
            rtpParameters: params.rtpParameters
        })

        const { track } = consumer;

        remoteVideo.srcObject = new MediaStream([track]);

        socket.emit("consumer-resume");
    })
}

btnLocalVideo.addEventListener('click', getLocalStream);
// btnRtpCapabilities.addEventListener('click', getRtpCapabilities);
// btnDevice.addEventListener('click', createDevice);
// btnCreateSendTransport.addEventListener('click', createSendTransport);
// btnConnectSendTransport.addEventListener('click', connectSendTransport);
btnRecvSendTransport.addEventListener('click', goConsume);
// btnConnectRecvTransport.addEventListener('click', connectRecvTransport);