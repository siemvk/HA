import { playerStateUpdate, type element, type playerId, type toClient, type toServer } from "../packet.js"

const code = document.getElementById("code");

let URL = "ws://localhost:8081"

if (window.origin.includes("siemvk.nl")) {
    URL = "ws://ws.siemvk.nl/"
}

const ws = new WebSocket(URL)
const adminWs = new WebSocket(URL)

let pin = "None"
let Apin = "None"

let fase: "voorbereiden" | "bezig" | "bingo" = "voorbereiden"

function setFase(newFase: "voorbereiden" | "bezig" | "bingo" = "voorbereiden") {
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
    document.getElementById("code-card")!.hidden = true
    document.getElementById("main-card")!.hidden = false
    setFase("bezig")
}

const players: string[] = []

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
            players.filter((v) => { if (v == msg.player) { return false; } return true })
            console.log("Disconnect: ", msg.player)

        }
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
        }
    }
})

function sendAdminState() {
    if (admin == undefined) {
        return
    }
    let elList: element[] = [
        {
            type: "txt",
            content: "fase: " + fase,
            id: "state"
        },
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
            content: "fase"
        },
        {
            type: "button",
            id: "setFase",
            content: "set fase",
            icon: "save",
            interaction: "sendToHost"
        }
    ]
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
}