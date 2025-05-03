let localStream;
let remoteStream;
let peerConnection;
let roomId;

// Elementos HTML
const localVideo = document.getElementById("local");
const remoteVideo = document.getElementById("remote");
const connectionStatus = document.getElementById("connectionStatus");
const toggleVideoBtn = document.getElementById("toggleVideo");
const toggleAudioBtn = document.getElementById("toggleAudio");
const startCallBtn = document.getElementById("startCall");

// Configuración de servidores ICE (incluye TURN servers de Twilio)
const servers = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:global.stun.twilio.com:3478" }
    // Twilio provee servidores TURN automáticamente en su token
  ],
};

// Inicializar la aplicación
async function init() {
  try {
    // Actualizar estado
    updateStatus("Obteniendo token...");
    
    // Obtener token de Twilio
    const identity = "Usuario_" + Math.floor(Math.random() * 1000);
    const response = await fetch(`/token?identity=${identity}`);
    
    if (!response.ok) {
      throw new Error("Error al obtener token: " + await response.text());
    }
    
    const data = await response.json();
    console.log("Token recibido:", data.token);
    updateStatus("Token recibido");
    
    // Obtener acceso a la cámara y micrófono
    updateStatus("Solicitando acceso a cámara y micrófono...");
    localStream = await navigator.mediaDevices.getUserMedia({ 
      video: true, 
      audio: true 
    });
    localVideo.srcObject = localStream;
    updateStatus("Cámara y micrófono conectados");
    
    // Configurar los botones de control
    setupControls();

  } catch (error) {
    console.error("Error en la inicialización:", error);
    updateStatus("Error: " + error.message, true);
  }
}

// Crear o unirse a una sala
async function startCall() {
  try {
    // Solicitar ID de sala
    let userInput = prompt("Ingrese un código de sala para crear o unirse:", generateRandomRoomId());
    if (!userInput) return;
    
    roomId = userInput.trim();
    updateStatus(`Conectando a la sala: ${roomId}...`);
    
    // Inicializar la conexión peer
    setupPeerConnection();
    
    // Verificar si la sala existe
    const checkRoomResponse = await fetch(`/check-room?roomId=${roomId}`);
    const roomData = await checkRoomResponse.json();
    
    if (roomData.exists) {
      // Si la sala existe, unirse a ella
      updateStatus("Sala encontrada, uniéndose como participante...");
      joinRoom();
    } else {
      // Si la sala no existe, crearla
      updateStatus("Creando nueva sala...");
      createRoom();
    }
    
  } catch (error) {
    console.error("Error al iniciar llamada:", error);
    updateStatus("Error al iniciar llamada: " + error.message, true);
  }
}

// Crear una nueva sala
async function createRoom() {
  try {
    // Crear oferta
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    
    // Enviar oferta al servidor
    const response = await fetch('/create-room', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roomId: roomId,
        offer: peerConnection.localDescription
      })
    });
    
    if (!response.ok) {
      throw new Error("Error al crear sala");
    }
    
    updateStatus("Sala creada. Esperando a que alguien se una...");
    
    // Escuchar respuestas
    listenForAnswers();
    
  } catch (error) {
    console.error("Error al crear sala:", error);
    updateStatus("Error al crear sala: " + error.message, true);
  }
}

// Unirse a una sala existente
async function joinRoom() {
  try {
    // Obtener la oferta de la sala
    const response = await fetch(`/get-offer?roomId=${roomId}`);
    const data = await response.json();
    
    // Establecer la descripción remota
    const offerDescription = new RTCSessionDescription(data.offer);
    await peerConnection.setRemoteDescription(offerDescription);
    
    // Crear respuesta
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    
    // Enviar respuesta al servidor
    const answerResponse = await fetch('/submit-answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roomId: roomId,
        answer: peerConnection.localDescription
      })
    });
    
    if (!answerResponse.ok) {
      throw new Error("Error al enviar respuesta");
    }
    
    updateStatus("Conectado a la sala. Esperando conexión...");
    
  } catch (error) {
    console.error("Error al unirse a la sala:", error);
    updateStatus("Error al unirse a la sala: " + error.message, true);
  }
}

// Escuchar respuestas (para creador de la sala)
async function listenForAnswers() {
  // Simular polling (en producción usarías WebSockets)
  const checkInterval = setInterval(async () => {
    try {
      const response = await fetch(`/get-answer?roomId=${roomId}`);
      
      if (!response.ok) {
        if (response.status === 404) {
          // Sin respuesta aún, continuar esperando
          return;
        }
        throw new Error("Error al obtener respuesta");
      }
      
      const data = await response.json();
      
      if (data.answer) {
        // Si hay respuesta, procesarla
        clearInterval(checkInterval);
        
        const answerDescription = new RTCSessionDescription(data.answer);
        await peerConnection.setRemoteDescription(answerDescription);
        
        updateStatus("Respuesta recibida. Conectando...");
      }
      
    } catch (error) {
      console.error("Error al escuchar respuestas:", error);
      clearInterval(checkInterval);
    }
  }, 2000); // Verificar cada 2 segundos
}

// Configurar la conexión peer-to-peer
function setupPeerConnection() {
  // Crear la conexión peer
  peerConnection = new RTCPeerConnection(servers);
  remoteStream = new MediaStream();
  remoteVideo.srcObject = remoteStream;

  // Agregar las pistas locales a la conexión
  localStream.getTracks().forEach(track => {
    peerConnection.addTrack(track, localStream);
  });

  // Escuchar pistas entrantes
  peerConnection.ontrack = event => {
    event.streams[0].getTracks().forEach(track => {
      remoteStream.addTrack(track);
    });
    updateStatus("Participante remoto conectado");
  };

  // Escuchar candidatos ICE
  peerConnection.onicecandidate = event => {
    if (event.candidate) {
      // Enviar candidato al servidor
      sendIceCandidate(event.candidate);
    }
  };

  // Escuchar cambios de estado de conexión
  peerConnection.onconnectionstatechange = () => {
    console.log("Estado de conexión:", peerConnection.connectionState);
    if (peerConnection.connectionState === 'connected') {
      updateStatus("Conexión establecida");
    } else if (peerConnection.connectionState === 'disconnected' || 
               peerConnection.connectionState === 'failed') {
      updateStatus("Conexión perdida", true);
    }
  };

  console.log("Conexión peer configurada con éxito");
}

// Enviar candidato ICE al servidor
async function sendIceCandidate(candidate) {
  try {
    const response = await fetch('/ice-candidate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roomId: roomId,
        candidate: candidate
      })
    });
    
    if (!response.ok) {
      console.error("Error al enviar candidato ICE");
    }
    
  } catch (error) {
    console.error("Error al enviar candidato ICE:", error);
  }
}

// Configurar controles de video y audio
function setupControls() {
  // Toggle de video
  toggleVideoBtn.addEventListener('click', () => {
    const videoTrack = localStream.getVideoTracks()[0];
    if (videoTrack) {
      const enabled = !videoTrack.enabled;
      videoTrack.enabled = enabled;
      toggleVideoBtn.textContent = enabled ? "Pausar Video" : "Activar Video";
    }
  });
  
  // Toggle de audio
  toggleAudioBtn.addEventListener('click', () => {
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
      const enabled = !audioTrack.enabled;
      audioTrack.enabled = enabled;
      toggleAudioBtn.textContent = enabled ? "Silenciar Audio" : "Activar Audio";
    }
  });
  
  // Iniciar llamada
  startCallBtn.addEventListener('click', startCall);
}

// Actualizar estado en la interfaz
function updateStatus(message, isError = false) {
  connectionStatus.textContent = "Estado: " + message;
  connectionStatus.style.backgroundColor = isError ? "#ffdddd" : "#f0f0f0";
}

// Generar ID de sala aleatorio
function generateRandomRoomId() {
  return Math.random().toString(36).substring(2, 8);
}

// Iniciar la aplicación cuando cargue la página
window.addEventListener('DOMContentLoaded', init);