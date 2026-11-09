const db = require('./db');

// Função que simula uma leitura do Finder Opta
function simularLeituraOpta() {
  // IDs fictícios das tuas máquinas/satélites
  const maquinas = [1, 2, 3]; 
  const maquinaId = maquinas[Math.floor(Math.random() * maquinas.length)];

  // Gerar valores aleatórios realistas
  const temperatura = (20 + Math.random() * 15).toFixed(2); // Ex: 23.45 °C
  const humidade = (40 + Math.random() * 35).toFixed(2);    // Ex: 58.10 %
  const tensao = (215 + Math.random() * 15).toFixed(1);      // Ex: 223.5 V
  const status = Math.random() > 0.15 ? 'Operacional' : 'Alerta'; // 85% hipótese de estar OK

  // Query SQL para inserir na tua tabela de histórico/telemetria
  const sql = `
    INSERT INTO telemetria (maquina_id, temperatura, humidade, tensao, status, criado_em)
    VALUES (?, ?, ?, ?, ?, NOW())
  `;

  db.query(sql, [maquinaId, temperatura, humidade, tensao, status], (err, result) => {
    if (err) {
      console.error('❌ Erro na simulação de dados:', err.message);
      return;
    }
    console.log(`📡 [SIMULADOR OPTA] Máquina ${maquinaId} -> Temp: ${temperatura}°C | Status: ${status}`);
  });
}

// Executar a simulação a cada 5 segundos (5000 ms)
const INTERVALO_MS = 5000;
setInterval(simularLeituraOpta, INTERVALO_MS);

console.log(`🚀 Simulador do Finder Opta iniciado (a enviar dados a cada ${INTERVALO_MS / 1000}s)...`);