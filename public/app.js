// Variables globales
let localStream;
let remoteStream;
let peerConnection;
let socket;
let roomId;
let userId;

// Elementos DOM
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const connectionStatus = document.getElementById('connectionStatus');
const toggleVideoBtn = document.getElementById('toggleVideoBtn');
const toggleAudioBtn = document.getElementById('toggleAudioBtn');
const roomIdInput = document.getElementById('roomId');
const joinRoomBtn = document.getElementById('joinRoomBtn');

// Configuración ICE Servers (STUN/TURN)
const iceServers = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

// Inicializar aplicación
async function init() {
  updateStatus('Iniciando aplicación...');
  
  try {
    // Inicializar Socket.IO
    socket = io();
    setupSocketListeners();
    
    // Obtener token de Twilio (opcional para servidores TURN)
    const response = await fetch('/token');
    const data = await response.json();
    console.log('Token recibido:', data.token);
    userId = data.identity;
    
    // Solicitar acceso a cámara y micrófono
    updateStatus('Solicitando acceso a cámara y micrófono...');
    localStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true
    });
    
    // Mostrar video local
    localVideo.srcObject = localStream;
    updateStatus('Cámara y micrófono conectados. Listo para unirse a una sala.');
    
    // Configurar botones de control
    setupControls();
    
  } catch (error) {
    console.error('Error al inicializar:', error);
    updateStatus('Error: ' + error.message, true);
  }
}

// Configurar escuchas de Socket.IO
function setupSocketListeners() {
  // Cuando un usuario se conecta a nuestra sala
  socket.on('user-connected', (newUserId) => {
    updateStatus(`Usuario ${newUserId} conectado a la sala. Iniciando llamada...`);
    // Iniciar conexión con el nuevo usuario
    callUser();
  });
  
  // Cuando un usuario se desconecta
  socket.on('user-disconnected', (userId) => {
    updateStatus(`Usuario ${userId} desconectado de la sala.`);
    // Limpiar video remoto
    remoteVideo.srcObject = null;
  });
  
  // Cuando recibimos una oferta
  socket.on('receive-offer', async (offer) => {
    updateStatus('Oferta recibida. Generando respuesta...');
    try {
      // Crear conexión peer si no existe
      if (!peerConnection) {
        createPeerConnection();
      }
      
      // Establecer descripción remota
      await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
      
      // Crear respuesta
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
      
      // Enviar respuesta
      socket.emit('answer', roomId, peerConnection.localDescription);
      updateStatus('Respuesta enviada. Estableciendo conexión...');
      
    } catch (error) {
      console.error('Error al procesar oferta:', error);
      updateStatus('Error al procesar oferta: ' + error.message, true);
    }
  });
  
  // Cuando recibimos una respuesta
  socket.on('receive-answer', async (answer) => {
    updateStatus('Respuesta recibida. Estableciendo conexión...');
    try {
      await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
    } catch (error) {
      console.error('Error al establecer respuesta:', error);
      updateStatus('Error al establecer respuesta: ' + error.message, true);
    }
  });
  
  // Cuando recibimos un candidato ICE
  socket.on('receive-ice-candidate', async (candidate) => {
    try {
      if (peerConnection) {
        await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
      }
    } catch (error) {
      console.error('Error al añadir candidato ICE:', error);
    }
  });
}

// Crear y configurar la conexión peer
function createPeerConnection() {
  peerConnection = new RTCPeerConnection(iceServers);
  remoteStream = new MediaStream();
  remoteVideo.srcObject = remoteStream;
  
  // Añadir pistas locales
  localStream.getTracks().forEach(track => {
    peerConnection.addTrack(track, localStream);
  });
  
  // Escuchar pistas remotas
  peerConnection.ontrack = (event) => {
    event.streams[0].getTracks().forEach(track => {
      remoteStream.addTrack(track);
    });
    updateStatus('Participante remoto conectado. Videollamada activa.');
  };
  
  // Enviar candidatos ICE
  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('ice-candidate', roomId, event.candidate);
    }
  };
  
  // Monitorear el estado de la conexión
  peerConnection.onconnectionstatechange = () => {
    console.log('Estado de conexión:', peerConnection.connectionState);
    if (peerConnection.connectionState === 'connected') {
      updateStatus('Conexión establecida. Videollamada activa.');
    } else if (peerConnection.connectionState === 'disconnected' || 
               peerConnection.connectionState === 'failed') {
      updateStatus('Conexión perdida', true);
    }
  };
  
  console.log('Conexión peer configurada');
}

// Iniciar una llamada (enviar oferta)
async function callUser() {
  try {
    // Crear conexión peer si no existe
    if (!peerConnection) {
      createPeerConnection();
    }
    
    // Crear oferta
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    
    // Enviar oferta a través de Socket.IO
    socket.emit('offer', roomId, peerConnection.localDescription);
    updateStatus('Oferta enviada. Esperando respuesta...');
    
  } catch (error) {
    console.error('Error al iniciar llamada:', error);
    updateStatus('Error al iniciar llamada: ' + error.message, true);
  }
}

// Unirse a una sala
function joinRoom() {
  // Obtener el ID de la sala
  roomId = roomIdInput.value.trim();
  
  // Validar ID de sala
  if (!roomId) {
    roomId = 'sala_' + Math.random().toString(36).substring(2, 8);
    roomIdInput.value = roomId;
  }
  
  // Unirse a la sala mediante Socket.IO
  socket.emit('join-room', roomId, userId);
  updateStatus(`Unido a la sala: ${roomId}. Esperando participantes...`);
}

// Configurar controles de video y audio
function setupControls() {
  // Toggle de video
  toggleVideoBtn.addEventListener('click', () => {
    const videoTrack = localStream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled;
      toggleVideoBtn.textContent = videoTrack.enabled ? 'Pausar Video' : 'Activar Video';
    }
  });
  
  // Toggle de audio
  toggleAudioBtn.addEventListener('click', () => {
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      toggleAudioBtn.textContent = audioTrack.enabled ? 'Silenciar Audio' : 'Activar Audio';
    }
  });
  
  // Botón para unirse a sala
  joinRoomBtn.addEventListener('click', joinRoom);
}

// Actualizar el estado en la UI
function updateStatus(message, isError = false) {
  connectionStatus.textContent = 'Estado: ' + message;
  connectionStatus.style.backgroundColor = isError ? '#ffdddd' : '#f0f0f0';
  console.log('Estado:', message);
}

// Iniciar al cargar la página
window.addEventListener('DOMContentLoaded', init);