// gameHost/index.ts
var code = document.getElementById("code");
var URL = "wss://ws.siemvk.nl";
if (localStorage.getItem("testing") !== null) {
  URL = "ws://localhost:8081";
}
var ws = new WebSocket(URL);
var adminWs = new WebSocket(URL);
var pin = "None";
var Apin = "None";
var fase = "voorbereiden";
function setFase(newFase = "voorbereiden") {
  if (newFase == "bezig") {
    document.getElementById("code-card").hidden = true;
    document.getElementById("main-card").hidden = false;
  }
  fase = newFase;
  players.forEach((player) => {
    sendUI(player);
  });
}
function wsSend(ws2, data) {
  ws2.send(JSON.stringify(data));
}
ws.addEventListener("open", (ev) => {
  document.getElementById("start-knop").onclick = init;
  wsSend(ws, {
    type: "newGame",
    name: "BINGO!!!",
    public: true
  });
});
adminWs.addEventListener("open", (ev) => {
  wsSend(adminWs, {
    type: "newGame",
    name: "BINGO!!! (admin)",
    public: false
  });
});
function init() {
  setFase("bezig");
}
var players = [];
ws.addEventListener("message", (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.type == "pin") {
    pin = msg.pin;
    updC();
  }
  if (msg.type == "playerUpdate") {
    if (msg.update == 1 /* connect */) {
      players.push(msg.player);
      console.log("Connect: ", msg.player);
      sendUI(msg.player);
    } else {
      players = players.filter((v) => {
        if (v == msg.player) {
          return false;
        }
        return true;
      });
      console.log("Disconnect: ", msg.player);
    }
    sendAdminState();
  }
});
function sendUI(player) {
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
      });
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
      });
      break;
    default:
      break;
  }
}
var admin = undefined;
adminWs.addEventListener("message", (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.type == "pin") {
    Apin = msg.pin;
    updC();
  }
  if (msg.type == "playerUpdate" && msg.update == 1 /* connect */) {
    if (admin != null) {
      wsSend(adminWs, {
        type: "kick",
        player: msg.player
      });
    } else {
      admin = msg.player;
      sendAdminState();
    }
  } else if (msg.type == "playerUpdate" && msg.update == 0 /* disconnect */) {
    admin = undefined;
  }
  if (msg.type == "UI-msg") {
    if (msg.elementInteractedWith.id == "setFase") {
      const newFase = msg.elementData.filter((el) => el.id == "faseSelector")[0];
      if (newFase?.type == "field") {
        setFase(newFase.value);
      }
    } else if (msg.elementInteractedWith.id == "toggelCodeView") {
      document.getElementById("modal1")?.togglePopover();
    } else if (msg.elementInteractedWith.id.startsWith("kick-")) {
      wsSend(ws, {
        type: "kick",
        player: msg.elementInteractedWith.id.split("-")[1]
      });
    }
  }
});
function sendAdminState() {
  if (admin == undefined) {
    return;
  }
  let elList = [
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
  ];
  if (fase == "bezig") {
    elList.push({
      type: "button",
      id: "nextNum",
      content: "Volgend numer",
      icon: "navigate_next",
      interaction: "sendToHost"
    });
  }
  players.forEach((p) => {
    elList.push({
      type: "button",
      id: "kick-" + p,
      content: "Kick " + p,
      icon: "block",
      interaction: "sendToHost"
    });
  });
  wsSend(adminWs, {
    type: "UI-set",
    player: admin,
    elements: elList
  });
}
function updC() {
  code.innerText = "PIN: " + pin;
  document.getElementById("pin-pop").innerText = "De code is: " + pin;
  document.getElementById("adminPin").innerText = "De code is: " + Apin;
  sendAdminState();
  renderQR("my-canvas", pin);
  renderQR("my-canvas-popup", pin);
}
function renderQR(el, pin2) {
  const canvas = document.getElementById(el);
  if (!canvas) {
    console.error("Canvas element not found!");
    return;
  }
  const textToEncode = `https://client.siemvk.nl/player/?p=${pin2}`;
  QRCode.toCanvas(canvas, textToEncode, {
    width: 200,
    margin: 2,
    color: {
      dark: "#000000",
      light: "#ffffff"
    }
  }, (error) => {
    if (error) {
      console.error("Failed to generate QR code:", error);
    } else {
      console.log("QR code generated successfully!");
    }
  });
}

//# debugId=9DC5B0FC5B7AEFB164756E2164756E21
//# sourceMappingURL=index.js.map
