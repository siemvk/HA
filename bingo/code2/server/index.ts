import { randomInt } from 'crypto';
import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import {
    playerStateUpdate,
    type pin,
    type playerId,
    type toClient,
    type toServer,
    type element,
    type errors
} from "../packet.ts"

const PORT = 8081;
const server = http.createServer((req, res) => {
    // Redirect all standard HTTP traffic
    res.writeHead(301, { Location: 'https://client.siemvk.nl' });
    res.end();
});

const wss = new WebSocketServer({ server });

type Game = {
    name: string;
    pin: string;
    public: boolean;
    clients: Player[];
    host: WebSocket;
};

type Player = {
    ws: WebSocket;
    id: playerId;
};

function genPin(): pin {
    return randomInt(0, 4).toString() + randomInt(0, 4).toString() + randomInt(0, 4).toString() + randomInt(0, 4).toString();
}

const games: Record<string, Game> = {};

console.log(`WebSocket server is running on ws://localhost:${PORT}`);

function wsSend(ws: WebSocket, data: toClient) {
    ws.send(JSON.stringify(data));
}

wss.on('connection', (self: WebSocket) => {
    const id = randomInt(1000, 10000).toString();
    console.log(`C - ${id} - 200`);

    let connectedTo: Game | undefined;

    self.on('message', (data: Buffer, isBinary: boolean) => {
        const msg: toServer = JSON.parse(data.toString());

        if (msg.type === "newGame") {
            connectedTo = {
                pin: genPin(),
                name: msg.name,
                clients: [],
                host: self,
                public: msg.public
            };
            games[connectedTo.pin] = connectedTo;

            wsSend(self, {
                type: "pin",
                pin: connectedTo.pin
            });

        } else if (msg.type === "connect") {
            const game = games[msg.pin];

            if (game) {
                connectedTo = game;
                connectedTo.clients.push({ ws: self, id: id });

                wsSend(game.host, {
                    type: "playerUpdate",
                    update: playerStateUpdate.connect,
                    player: id
                });

                wsSend(self, { type: "OK", ok: true });
            } else {
                wsSend(self, { type: "OK", ok: false });
            }

        } else if (msg.type === "kick") {
            if (connectedTo && connectedTo.host === self) {
                const playerToKick = connectedTo.clients.find(p => p.id === msg.player);
                if (playerToKick) {
                    playerToKick.ws.close(4000, "Kicked by host");
                }
            }

        } else if (msg.type === "disconnect") {
            self.close(1000, "Client requested disconnect");

        } else if (msg.type === "UI-set") {
            if (connectedTo && connectedTo.host === self) {
                const targetPlayer = connectedTo.clients.find(p => p.id === msg.player);
                if (targetPlayer) {
                    wsSend(targetPlayer.ws, {
                        type: "UI-set",
                        elements: msg.elements
                    });
                }
            }

        } else if (msg.type === "UI-update") {
            if (connectedTo && connectedTo.host === self) {
                const targetPlayer = connectedTo.clients.find(p => p.id === msg.player);
                if (targetPlayer) {
                    wsSend(targetPlayer.ws, {
                        type: "UI-update",
                        updated: msg.updated
                    });
                }
            }

        } else if (msg.type === "UI-msg") {
            // When a client interacts with their UI, route it to the host
            // and attach the player's ID so the host knows who triggered it.
            if (connectedTo && connectedTo.host !== self) {
                wsSend(connectedTo.host, {
                    type: "UI-msg",
                    elementInteractedWith: msg.elementInteractedWith,
                    player: id, // Attach the sender's ID
                    elementData: msg.elementData
                });
            }
        }
    });

    self.on('close', (code) => {
        if (!connectedTo) return;

        if (connectedTo.host === self) {
            connectedTo.clients.forEach((client) => {
                client.ws.close(205);
            });
            delete games[connectedTo.pin];
        } else {
            wsSend(connectedTo.host, {
                type: "playerUpdate",
                update: playerStateUpdate.disconnect,
                player: id
            });

            connectedTo.clients = connectedTo.clients.filter(client => client.ws !== self);
        }

        connectedTo = undefined;
    });

    self.on('error', (error: Error) => {
        console.error(`WebSocket error: ${error.message}`);
        self.close(400);
    });
});

server.listen(PORT, () => {
    console.log(`Listening on port ${PORT} for both HTTP and WS`);
});