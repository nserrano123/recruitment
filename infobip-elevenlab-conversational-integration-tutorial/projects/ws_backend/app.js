const ws = require('ws');
const http = require('http');

const ELEVENLABS_AGENT_ID = ""; // Your ElevenLabs agent ID
const ELEVENLABS_API_KEY = "";  // Your ElevenLabs API KEY

const server = http.createServer();
const wss = new ws.WebSocketServer({ server })

async function handleWebsocket(infobipWs) {
    let elevenLabsWs = null;

    infobipWs.on("error", console.error);
    async function getSignedUrl() {
        const response = await fetch(
            `https://api.elevenlabs.io/v1/convai/conversation/get_signed_url?agent_id=${ELEVENLABS_AGENT_ID}`,
            {
                method: "GET",
                headers: {
                    "xi-api-key": `${ELEVENLABS_API_KEY}`,
                },
            }
        );

        if (!response.ok) {
            throw new Error(`Failed to get signed URL: ${response.statusText}`);
        }
        return (await response.json()).signed_url;
    }

    const setupElevenLabs = async () => {
        try {
            const signedUrl = await getSignedUrl();
            elevenLabsWs = new ws.WebSocket(signedUrl);

            elevenLabsWs.on("open", () => {
                console.log("[ElevenLabs] Connected to Conversational AI");
                const initialConfig = {
                    type: "conversation_initiation_client_data"
                };
                elevenLabsWs.send(JSON.stringify(initialConfig));
            });

            elevenLabsWs.on("message", data => {
                try {
                    const message = JSON.parse(data);
                    switch (message.type) {
                        case "conversation_initiation_metadata":
                            console.log("[ElevenLabs] Received initiation metadata");
                            break;
                        case "audio":
                            const buff = Buffer.from(message.audio_event.audio_base_64, "base64");
                            infobipWs.send(buff);
                            break;
                        case "agent_response_correction":
                        case "interruption":
                            infobipWs.send(JSON.stringify({
                                action: "clear"
                            }));
                            break;
                        case "ping":
                            if (message.ping_event?.event_id) {
                                elevenLabsWs.send(
                                    JSON.stringify({
                                        type: "pong",
                                        event_id: message.ping_event.event_id,
                                    })
                                );
                            }
                            break;
                        case "agent_response":
                            console.log(`[ElevenLabs] Agent response: ${message.agent_response_event?.agent_response}`);
                            break;

                        case "user_transcript":
                            console.log(`[ElevenLabs] User transcript: ${message.user_transcription_event?.user_transcript}`);
                            break;

                        default:
                            console.log(`[ElevenLabs] Unhandled message type: ${message.type}`);
                    }
                } catch (error) {
                    console.error("[ElevenLabs] Error processing message:", error);
                }
            });

            elevenLabsWs.on("error", error => console.error("[ElevenLabs] WebSocket error:", error));
            elevenLabsWs.on("close", () => console.log("[ElevenLabs] Disconnected"));
        } catch (error) {
            console.error("[ElevenLabs] Setup error:", error);
        }
    };

    // Set up ElevenLabs connection
    setupElevenLabs();

    // Handle messages from Infobip
    infobipWs.on("message", message => {
        try {
            if (typeof message === "string") {
                // JSON event, we ignore those for now
                return
            }

            if (elevenLabsWs?.readyState === WebSocket.OPEN) {
                const audioMessage = {
                    user_audio_chunk: Buffer.from(message).toString("base64"),
                };
                elevenLabsWs.send(JSON.stringify(audioMessage));
            }
        } catch (error) {
            console.error("[Infobip] Error processing message:", error);
        }
    });

    // Handle WebSocket closure
    infobipWs.on("close", () => {
        console.log("[Infobip] Client disconnected");
        if (elevenLabsWs?.readyState === WebSocket.OPEN) {
            elevenLabsWs.close();
        }
    });
}

wss.on('connection', ws => handleWebsocket(ws));

server.listen(3500, () => {
    console.log(`WS Server is running on port ${server.address().port}`);
});
