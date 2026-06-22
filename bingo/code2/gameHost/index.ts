import { playerStateUpdate, type element, type playerId, type toClient, type toServer } from "../packet.js"
/// <reference types="qrcode" />
import type typesForQR from 'qrcode';
declare const QRCode: typeof typesForQR;

const code = document.getElementById("code");

let URL = "wss://ws.siemvk.nl"

if (localStorage.getItem("testing") !== null) {
    URL = "ws://localhost:8081"
}

const ws = new WebSocket(URL)
const adminWs = new WebSocket(URL)

let pin = "None"
let Apin = "None"

let fase: "voorbereiden" | "bezig" | "bingo" = "voorbereiden"

function setFase(newFase: "voorbereiden" | "bezig" | "bingo" = "voorbereiden") {
    if (newFase == "bezig") {
        document.getElementById("code-card")!.hidden = true
        document.getElementById("main-card")!.hidden = false
    }
    fase = newFase;
    players.forEach((player) => {
        sendUI(player)
    })
}

function wsSend(ws: WebSocket, data: toServer) {
    ws.send(JSON.stringify(data))
}


ws.addEventListener("open", (ev) => {
    document.getElementById("start-knop")!.onclick = init
    wsSend(ws, {
        type: "newGame",
        name: "BINGO!!!",
        public: true
    })
})

adminWs.addEventListener("open", (ev) => {
    wsSend(adminWs, {
        type: "newGame",
        name: "BINGO!!! (admin)",
        public: false
    })
})

function init() {
    setFase("bezig")
}

let players: string[] = []

ws.addEventListener("message", (ev) => {
    // aaaaaaa
    const msg: toClient = JSON.parse(ev.data)

    if (msg.type == "pin") {
        pin = msg.pin
        updC();
    }
    if (msg.type == "playerUpdate") {
        if (msg.update == playerStateUpdate.connect) {
            players.push(msg.player)
            console.log("Connect: ", msg.player)
            sendUI(msg.player)

        } else {
            players = players.filter((v) => { if (v == msg.player) { return false; } return true })
            console.log("Disconnect: ", msg.player)
        }
        sendAdminState();
    }

})

function sendUI(player: playerId) {
    switch (fase) {
        case "voorbereiden":
            wsSend(ws, {
                type: "UI-set",
                player,
                elements: [
                    {
                        type: "txt",
                        content: "Wacht tot de bingo begint!",
                        id: "please-wait"
                    }
                ]
            })
            break;
        case "bezig":
            wsSend(ws, {
                type: "UI-set",
                player,
                elements: [
                    {
                        type: "txt",
                        content: "todo: bingo hier maken",
                        id: "placeholder"
                    },
                    {
                        type: "button",
                        content: "BINGO!!! ",
                        icon: "celebration",
                        id: "knop",
                        interaction: "sendToHost"
                    }
                ]
            })
            break;
        default:
            break;
    }
}

let admin: string | undefined = undefined
adminWs.addEventListener("message", (ev) => {
    // aaaaaaa
    const msg: toClient = JSON.parse(ev.data)

    if (msg.type == "pin") {
        Apin = msg.pin
        updC();
    }
    if (msg.type == "playerUpdate" && msg.update == playerStateUpdate.connect) {
        if (admin != undefined) {
            wsSend(adminWs, {
                type: "kick",
                player: msg.player
            })
        } else {
            admin = msg.player
            sendAdminState()
        }
    } else if (msg.type == "playerUpdate" && msg.update == playerStateUpdate.disconnect) {
        admin = undefined
    }

    if (msg.type == "UI-msg") {
        if (msg.elementInteractedWith.id == "setFase") {
            const newFase = msg.elementData.filter((el) => el.id == "faseSelector")[0]
            if (newFase?.type == "field") {
                setFase(newFase.value as "voorbereiden" | "bezig" | "bingo")
            }
        } else if (msg.elementInteractedWith.id == "toggelCodeView") {
            document.getElementById("modal1")?.togglePopover();
        } else if (msg.elementInteractedWith.id.startsWith("kick-")) {
            wsSend(ws, {
                type: "kick",
                player: msg.elementInteractedWith.id.split("-")[1]!
            })
        }
    }
})

function sendAdminState() {
    if (admin == undefined) {
        return
    }
    let elList: element[] = [
        {
            type: "field",
            fieldType: "radio",
            id: "faseSelector",
            icon: "dns",
            options: [
                "voorbereiden",
                "bezig",
                "bingo"
            ],
            content: "fase",
            value: fase
        },
        {
            type: "button",
            id: "setFase",
            content: "set fase",
            icon: "save",
            interaction: "sendToHost"
        },
        {
            type: "button",
            id: "toggelCodeView",
            content: "Toggel code",
            icon: "dns",
            interaction: "sendToHost"
        }
    ]
    if (fase == "bezig") {
        elList.push({
            type: "button",
            id: "nextNum",
            content: "Volgend numer",
            icon: "navigate_next",
            interaction: "sendToHost"
        })
    }
    players.forEach((p) => {
        elList.push({
            type: 'button',
            id: "kick-" + p,
            content: "Kick " + p,
            icon: "block",
            interaction: "sendToHost"
        })
    })
    wsSend(adminWs, {
        type: "UI-set",
        player: admin,
        elements: elList
    })
}


function updC() {
    code!.innerText = "PIN: " + pin
    document.getElementById("pin-pop")!.innerText = "De code is: " + pin
    document.getElementById("adminPin")!.innerText = "De code is: " + Apin
    sendAdminState();
    renderQR('my-canvas', pin);
    renderQR('my-canvas-popup', pin);
}



function renderQR(el: string, pin: string) {
    const canvas = document.getElementById(el) as HTMLCanvasElement;

    // Safety check to ensure the element exists
    if (!canvas) {
        console.error('Canvas element not found!');
        return;
    }

    const textToEncode = `https://client.siemvk.nl/player/?p=${pin}`;

    // 3. Generate the QR code with type-safe options
    QRCode.toCanvas(canvas, textToEncode, {
        width: 200,
        margin: 2,
        color: {
            dark: '#000000',  // Black dots
            light: '#ffffff'  // White background
        }
    }, (error: Error | null | undefined) => {
        if (error) {
            console.error('Failed to generate QR code:', error);
        } else {
            console.log('QR code generated successfully!');
        }
    });
}