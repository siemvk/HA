import { playerStateUpdate, type toClient, type toServer, type element } from "../packet.js"

let URL = "wss://ws.siemvk.nl"

if (localStorage.getItem("testing") !== null) {
    URL = "ws://localhost:8081"
}

(document.getElementById("pinInput") as HTMLInputElement).value = (new URLSearchParams(window.location.search)).get('p') as string
if ((new URLSearchParams(window.location.search)).has('p')) { document.getElementById("pinInput")!.parentElement!.hidden = true }

const ws = new WebSocket(URL)

let pin = "None"

function wsSend(ws: WebSocket, data: toServer) {
    ws.send(JSON.stringify(data))
}

ws.addEventListener("close", () => location.reload())

ws.addEventListener("open", (ev) => {
    genReserved()

    document.getElementById("sendBtn")!.onclick = () => {
        const input: HTMLInputElement = document.getElementById("pinInput") as HTMLInputElement;
        const input2: HTMLInputElement = document.getElementById("nameInput") as HTMLInputElement;

        wsSend(ws, {
            type: 'connect',
            pin: input.value,
            naam: input2.value.replaceAll("-", "_")
        })
    }
})

export function init() {
    document.getElementById("code-card")!.hidden = true
    document.getElementById("game-card")!.hidden = false
}

const players: string[] = []

ws.addEventListener("message", (ev) => {
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

    const gameCard = document.getElementById("game-card")!;

    switch (el.type) {
        case "txt": {
            const existingTxt = document.getElementById(el.id)
            if (existingTxt) {
                existingTxt.innerText = el.content
            } else {
                const newElement = document.createElement("h4");
                newElement.innerText = el.content
                newElement.id = el.id
                gameCard.appendChild(newElement)
            }
            break;
        }
        case "html-render": {
            const existingHtml = document.getElementById(el.id)
            if (existingHtml) {
                existingHtml.innerHTML = el.content
            } else {
                const newElement = document.createElement("div");
                newElement.innerHTML = el.content
                newElement.id = el.id
                gameCard.appendChild(newElement)
            }
            break;
        }
        case "button": {
            const existingBtn = document.getElementById(el.id)
            if (existingBtn) {
                existingBtn.innerText = el.content
            } else {
                const br = document.createElement("br")
                const newElement = document.createElement("button");
                newElement.classList.add("btn", "filled", "icon-right", "rounded", "waves-effect", "waves-light")
                newElement.innerHTML = el.content

                if (el.icon) {
                    const icon = document.createElement("i")
                    icon.innerHTML = el.icon
                    icon.classList.add("material-icons", "right")
                    icon.style.marginLeft = "8px"
                    newElement.appendChild(icon)
                }
                newElement.id = el.id

                newElement.onclick = () => {
                    if (el.interaction === "sendToHost") {
                        wsSend(ws, {
                            type: "UI-msg",
                            elementInteractedWith: el,
                            elementData: stateBuilder()
                        });
                    }
                }
                gameCard.appendChild(br)
                gameCard.appendChild(newElement)
            }
            break;
        }
        case "field": {
            const fieldEl = el as Extract<element, { type: "field", fieldType: any }>;
            const existingContainer = document.getElementById(el.id + "_container");

            if (existingContainer) {
                // Update existing field values safely
                if (fieldEl.fieldType === "txt") {
                    const input = document.getElementById(el.id) as HTMLInputElement;
                    if (input && fieldEl.value !== undefined) {
                        input.value = fieldEl.value;
                        // Keep Materialize label active if value changes programmatically
                        const label = document.querySelector(`label[for="${el.id}"]`);
                        if (label) label.classList.add("active");
                    }
                } else if (fieldEl.fieldType === "checkbox") {
                    const input = document.getElementById(el.id) as HTMLInputElement;
                    if (input && fieldEl.value !== undefined) input.checked = fieldEl.value === "true";
                } else if (fieldEl.fieldType === "radio") {
                    const radios = document.getElementsByName(el.id) as NodeListOf<HTMLInputElement>;
                    radios.forEach(r => r.checked = (r.value === fieldEl.value));
                }
            } else {
                // Create new Materialize-styled field
                const container = document.createElement("div");
                container.id = el.id + "_container";

                if (fieldEl.fieldType === "txt") {
                    // Apply requested classes for text field
                    container.className = "input-field col s12 m6 outlined";

                    const input = document.createElement("input");
                    input.type = "text";
                    input.id = el.id;
                    if (fieldEl.customStyle) input.classList.add(...fieldEl.customStyle);
                    if (fieldEl.value !== undefined) input.value = fieldEl.value;

                    const label = document.createElement("label");
                    label.setAttribute("for", el.id);
                    label.innerText = fieldEl.content;
                    // Materialize fix: push label up if there is initial data
                    if (fieldEl.value) label.classList.add("active");

                    container.appendChild(input);
                    container.appendChild(label);

                } else if (fieldEl.fieldType === "checkbox") {
                    container.className = "input-field col s12";

                    const label = document.createElement("label");

                    const input = document.createElement("input");
                    input.type = "checkbox";
                    input.id = el.id;
                    input.className = "filled-in"; // Apply filled-in class
                    if (fieldEl.customStyle) input.classList.add(...fieldEl.customStyle);
                    if (fieldEl.value !== undefined) input.checked = fieldEl.value === "true";

                    // Materialize requires a span next to the input for the text
                    const span = document.createElement("span");
                    span.innerText = fieldEl.content;

                    label.appendChild(input);
                    label.appendChild(span);
                    container.appendChild(label);

                } else if (fieldEl.fieldType === "radio") {
                    container.className = "input-field col s12";

                    // Group Label for radios
                    const groupLabel = document.createElement("span");
                    groupLabel.innerText = fieldEl.content;
                    groupLabel.style.display = "block";
                    groupLabel.style.marginBottom = "8px";
                    groupLabel.style.color = "#9e9e9e"; // Standard materialize label color
                    groupLabel.style.fontSize = "0.8rem";
                    container.appendChild(groupLabel);

                    fieldEl.options.forEach((opt, idx) => {
                        const p = document.createElement("p");
                        p.style.margin = "0"; // Tighten up the list

                        const label = document.createElement("label");

                        const radio = document.createElement("input");
                        radio.type = "radio";
                        radio.name = el.id;
                        radio.id = `${el.id}_${idx}`;
                        radio.value = opt;
                        radio.className = "with-gap"; // Apply with-gap class
                        if (fieldEl.value === opt) radio.checked = true;

                        const span = document.createElement("span");
                        span.innerText = opt;

                        label.appendChild(radio);
                        label.appendChild(span);
                        p.appendChild(label);
                        container.appendChild(p);
                    });
                }
                gameCard.appendChild(container);
            }
            break;
        }
        default: {
            alert("god is dood")
        }
    }
}

function stateBuilder(): element[] {
    const gameCard = document.getElementById("game-card")!;
    const elList: element[] = [];

    // 1. Scrape Text Elements
    const h4s = gameCard.querySelectorAll("h4");
    h4s.forEach(child => {
        if (child.id) {
            elList.push({
                type: "txt",
                content: child.innerHTML,
                id: child.id
            });
        }
    });

    // 2. Scrape Form Fields
    const inputs = gameCard.querySelectorAll("input");
    const processedRadios = new Set<string>();

    inputs.forEach(input => {
        if (input.type === "text") {
            elList.push({
                type: "field",
                fieldType: "txt",
                id: input.id,
                content: "",
                value: input.value,
                icon: ""
            });
        } else if (input.type === "checkbox") {
            elList.push({
                type: "field",
                fieldType: "checkbox",
                id: input.id,
                content: "",
                value: input.checked ? "true" : "false",
                icon: ""

            });
        } else if (input.type === "radio") {
            if (!processedRadios.has(input.name)) {
                processedRadios.add(input.name);
                const checkedOption = gameCard.querySelector(`input[name="${input.name}"]:checked`) as HTMLInputElement;
                elList.push({
                    type: "field",
                    fieldType: "radio",
                    id: input.name,
                    content: "",
                    value: checkedOption ? checkedOption.value : undefined,
                    options: [],
                    icon: ""
                });
            }
        }
    });

    return elList;
}