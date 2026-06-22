export type toServer = {
    type: "newGame",
    name: string,
    public: boolean
} | {
    type: "connect",
    pin: pin
} | {
    type: "kick",
    player: playerId,
} | {
    type: "disconnect"
} | {
    type: "UI-set",
    elements: element[],
    player: playerId
} | {
    type: "UI-update",
    updated: element,
    player: playerId
} | {
    type: "UI-msg",
    elementInteractedWith: element
}

export type toClient = {
    type: "pin",
    pin: pin
} | {
    type: "OK",
    ok: boolean
} | {
    type: "playerUpdate",
    player: playerId,
    update: playerStateUpdate
} | {
    type: "UI-set",
    elements: element[]
} | {
    type: "UI-update",
    updated: element
} | {
    type: "UI-msg",
    elementInteractedWith: element
    player: playerId
} | errors


export type element = {
    type: "txt" | "button" | "field" | "html-render",
    id: string,
    content: string,
    value?: string
}

export type errors = {
    type: "error",
    code: 500,
    desc: "Unkown server error"
} | {
    type: "error",
    code: 403,
    desc: "Forbidden, dit is niet toegestaan!"
} | {
    type: "error",
    code: 404,
    desc: "Iets niet gevonden, waarschijnlijk een match."
} | {
    type: "error",
    code: 405,
    desc: "dit typen verzoek is niet toegestaan"
}
export type pin = string
export type playerId = string
export enum playerStateUpdate {
    disconnect,
    connect,
    kicked
}