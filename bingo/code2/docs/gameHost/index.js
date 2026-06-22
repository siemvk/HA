// gameHost/index.ts
var code = document.getElementById("code");
var URL = "ws://localhost:8081";
if (window.origin.includes("siemvk.nl")) {
  URL = "ws://ws.siemvk.nl/";
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
      players.filter((v) => {
        if (v == msg.player) {
          return false;
        }
        return true;
      });
      console.log("Disconnect: ", msg.player);
    }
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
    }
    if (msg.elementInteractedWith.id == "toggelCodeView") {
      document.getElementById("modal1")?.togglePopover();
    }
  }
});
function sendAdminState() {
  if (admin == undefined) {
    return;
  }
  let elList = [
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
    },
    {
      type: "html-render",
      id: "spacer",
      content: "<br>"
    },
    {
      type: "button",
      id: "toggelCodeView",
      content: "Toggel code",
      icon: "dns",
      interaction: "sendToHost"
    }
  ];
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
}

//# debugId=259454AE1270A63164756E2164756E21
//# sourceMappingURL=index.js.map
