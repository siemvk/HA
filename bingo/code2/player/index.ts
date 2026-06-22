import { playerStateUpdate, type toClient, type toServer, type element } from "../packet.js"

const ws = new WebSocket("ws://localhost:8081")

let pin = "None"

function wsSend(ws: WebSocket, data: toServer) {
    ws.send(JSON.stringify(data))
}

ws.addEventListener("open", (ev) => {
    genReserved()

    document.getElementById("sendBtn")!.onclick = () => {
        const input: HTMLInputElement = document.getElementById("pinInput") as HTMLInputElement;
        wsSend(ws, {
            type: 'connect',
            pin: input.value
        })
    }

})

export function init() {
    document.getElementById("code-card")!.hidden = true
    document.getElementById("game-card")!.hidden = false
}

const players: string[] = []

ws.addEventListener("message", (ev) => {
    // aaaaaaa
    const msg: toClient = JSON.parse(ev.data)

    if (msg.type == "OK" && msg.ok) {
        init()
    } else if (msg.type == "UI-set") {
        document.getElementById("game-card")!.innerHTML = ""
        msg.elements.forEach((el) => {
            renderElement(el)
        })
    } else if (msg.type == "UI-update") {
        renderElement(msg.updated)
    }
})

let reservedIds: string[] = []

function genReserved() {
    const alles = document.querySelectorAll("[id]");
    alles.forEach((el) => {
        reservedIds.push(el.id)
    })
}

function renderElement(el: element) {
    if (reservedIds.includes(el.id)) {
        console.log("triggering id overwrite");
        el.id += "_content";
    }
    switch (el.type) {
        case "txt":
            const betaand = document.getElementById(el.id)
            if (betaand) {
                betaand.innerText = el.content
            } else {
                const newElement = document.createElement("h4");
                newElement.innerText = el.content
                newElement.id = el.id
                document.getElementById("game-card")!.appendChild(newElement)
            }
            break;
        case "html-render":
            const betaand3 = document.getElementById(el.id)
            if (betaand3) {
                betaand3.innerText = el.content
            } else {
                const newElement = document.createElement("thing");
                newElement.innerHTML = el.content
                newElement.id = el.id
                document.getElementById("game-card")!.appendChild(newElement)
            }
            break;
        case "button":
            const betaand4 = document.getElementById(el.id)
            if (betaand4) {
                betaand4.innerText = el.content
            } else {
                const newElement = document.createElement("button");
                // <button class="btn filled icon-right rounded waves-effect waves-light">
                newElement.classList.add("btn", "filled", "icon-right", "rounded", "waves-effect", "waves-light")
                newElement.innerHTML = el.content
                if (el.value !== undefined) {
                    // hier zit mogelijk icon data verstopt
                    const icon = document.createElement("i")
                    // < i class="material-icons right" style = "margin-left: 8px;" >
                    icon.innerHTML = el.value
                    icon.classList.add("material-icons")
                    newElement.appendChild(icon)
                }
                newElement.id = el.id
                document.getElementById("game-card")!.appendChild(newElement)
            }
            break;
        default:
            const betaand2 = document.getElementById(el.id)
            if (betaand2) {
                betaand2.innerText = el.content
            } else {
                const newElement = document.createElement("h4");
                newElement.innerText = "Render fout"
                newElement.id = el.id
                document.getElementById("game-card")!.appendChild(newElement)
            }
            break;
    }

}

function stateBuilder(): element[] {
    const gameCard = document.getElementById("game-card")!;
    const children = gameCard.children;
    const elList: element[] = []
    Array.from(children).forEach(child => {
        if (child.tagName == "h4") {
            elList.push({
                type: "txt",
                content: child.innerHTML,
                id: child.id
            })
        } else if (child.tagName == "thing") {
            // we can't include that state
            return;
        } else if (child.tagName == "") {

        }
    })
    return elList
}