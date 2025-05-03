require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { AccessToken } = require("twilio").jwt;
const { VideoGrant } = AccessToken;

const app = express();
const port = process.env.PORT || 3000;

// Almacenamiento en memoria para salas y señalización
// En producción usarías una base de datos
const rooms = new Map();
const iceQueue = new Map();

app.use(cors());
app.use(express.static("public"));
app.use(express.json());

// Ruta para verificar si una sala existe
app.get("/check-room", (req, res) => {
  const roomId = req.query.roomId;
  const exists = rooms.has(roomId);
  res.json({ exists });
});

// Ruta para crear una sala con oferta SDP
app.post("/create-room", (req, res) => {
  try {
    const { roomId, offer } = req.body;
    
    if (!roomId || !offer) {
      return res.status(400).json({ error: "Se requiere roomId y offer" });
    }
    
    // Guardar la oferta para la sala
    rooms.set(roomId, { 
      offer,
      answer: null,
      created: new Date()
    });
    
    // Inicializar la cola de candidatos ICE para esta sala
    iceQueue.set(roomId, []);
    
    console.log(`Sala creada: ${roomId}`);
    res.status(201).json({ success: true });
    
  } catch (err) {
    console.error("Error al crear sala:", err);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// Ruta para obtener la oferta de una sala
app.get("/get-offer", (req, res) => {
  const roomId = req.query.roomId;
  
  if (!roomId || !rooms.has(roomId)) {
    return res.status(404).json({ error: "Sala no encontrada" });
  }
  
  const room = rooms.get(roomId);
  res.json({ offer: room.offer });
});

// Ruta para enviar una respuesta a una oferta
app.post("/submit-answer", (req, res) => {
  try {
    const { roomId, answer } = req.body;
    
    if (!roomId || !answer || !rooms.has(roomId)) {
      return res.status(400).json({ error: "Datos inválidos o sala no encontrada" });
    }
    
    // Guardar la respuesta
    const room = rooms.get(roomId);
    room.answer = answer;
    rooms.set(roomId, room);
    
    console.log(`Respuesta recibida para sala: ${roomId}`);
    res.json({ success: true });
    
  } catch (err) {
    console.error("Error al guardar respuesta:", err);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// Ruta para obtener la respuesta de una sala
app.get("/get-answer", (req, res) => {
  const roomId = req.query.roomId;
  
  if (!roomId || !rooms.has(roomId)) {
    return res.status(404).json({ error: "Sala no encontrada" });
  }
  
  const room = rooms.get(roomId);
  
  if (!room.answer) {
    return res.status(404).json({ error: "Aún no hay respuesta", exists: true });
  }
  
  res.json({ answer: room.answer });
});

// Ruta para enviar candidatos ICE
app.post("/ice-candidate", (req, res) => {
  try {
    const { roomId, candidate } = req.body;
    
    if (!roomId || !candidate || !iceQueue.has(roomId)) {
      return res.status(400).json({ error: "Datos inválidos o sala no encontrada" });
    }
    
    // Añadir candidato a la cola
    const candidates = iceQueue.get(roomId);
    candidates.push(candidate);
    iceQueue.set(roomId, candidates);
    
    res.json({ success: true });
    
  } catch (err) {
    console.error("Error al guardar candidato ICE:", err);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// Ruta para obtener candidatos ICE
app.get("/ice-candidates", (req, res) => {
  const roomId = req.query.roomId;
  
  if (!roomId || !iceQueue.has(roomId)) {
    return res.status(404).json({ error: "Sala no encontrada" });
  }
  
  const candidates = iceQueue.get(roomId);
  
  // Limpiar la cola después de enviarla
  iceQueue.set(roomId, []);
  
  res.json({ candidates });
});

// Ruta para obtener token de Twilio
app.get("/token", (req, res) => {
  try {
    const identity = req.query.identity || "usuario_anónimo";
    
    // Verificar variables de entorno
    if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_API_KEY || !process.env.TWILIO_API_SECRET) {
      return res.status(500).json({ error: "Credenciales de Twilio no configuradas" });
    }
    
    // Crear token
    const token = new AccessToken(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_API_KEY,
      process.env.TWILIO_API_SECRET,
      { identity }
    );
    
    // Agregar permisos de video
    const videoGrant = new VideoGrant();
    token.addGrant(videoGrant);
    
    res.json({
      identity,
      token: token.toJwt()
    });
    
  } catch (err) {
    console.error("Error generando token:", err);
    res.status(500).json({ error: "Error generando token: " + err.message });
  }
});

// Limpieza periódica de salas antiguas
setInterval(() => {
  const now = new Date();
  rooms.forEach((room, roomId) => {
    const roomAge = now - room.created;
    // Eliminar salas más antiguas que 2 horas
    if (roomAge > 2 * 60 * 60 * 1000) {
      rooms.delete(roomId);
      iceQueue.delete(roomId);
      console.log(`Sala eliminada por inactividad: ${roomId}`);
    }
  });
}, 30 * 60 * 1000); // Ejecutar cada 30 minutos

app.listen(port, () => {
  console.log(`Servidor ejecutándose en http://localhost:${port}`);
});