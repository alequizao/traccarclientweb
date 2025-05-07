// public/traccar-service-worker.js
'use strict';

let config = {
    deviceId: '',
    serverUrl: '',
    intervalSeconds: 10, // Intervalo padrão para o SW tentar enviar para a API
};
let isCurrentlyTracking = false; // Indica se a página principal instruiu o SW a encaminhar dados
let lastAttemptedSendTimestamp = 0;
let isSendingLocationData = false; // Semáforo para envios de API

// Helper para obter todos os clientes (abas/janelas do navegador controladas por este SW)
async function getClients() {
    if (!self.clients) return [];
    return await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
}

// Helper para enviar mensagens para todos os clientes
async function sendMessageToClients(messagePayload) {
    const clients = await getClients();
    clients.forEach(client => {
        client.postMessage(messagePayload);
    });
}

async function callLogTraccarApi(locationData) {
    if (isSendingLocationData) {
        // console.log('[SW] Envio de localização já em progresso, pulando esta tentativa.');
        return; // Retorna cedo se já estiver enviando
    }
    isSendingLocationData = true;
    const currentTime = new Date().toLocaleTimeString('pt-BR');
    sendMessageToClients({ type: 'status', message: `[Serviço ${currentTime}] Tentando enviar dados para o servidor Traccar... (${locationData.lat.toFixed(4)}, ${locationData.lon.toFixed(4)})` });

    try {
        const response = await fetch('/api/log-traccar', { // Chama a API Route do Next.js
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(locationData), // locationData já deve incluir serverUrl e deviceId da página
        });

        const resultJson = await response.json(); // Espera-se que a API route retorne JSON

        if (response.ok && resultJson.success) {
            sendMessageToClients({ type: 'success', message: `${resultJson.message || 'Dados enviados com sucesso pela API.'}` });
        } else {
            // A API route já deve ter tratado erros do Traccar e retornado uma mensagem user-friendly
            sendMessageToClients({ type: 'error', message: `[Serviço] Falha no encaminhamento (API retornou HTTP ${response.status}): ${resultJson.message || 'Erro desconhecido da API /api/log-traccar.'}` });
        }
    } catch (error) { // Erro de rede ao chamar /api/log-traccar (ex: servidor da app offline)
        console.error('[SW] Erro de rede ao chamar API /api/log-traccar:', error);
        sendMessageToClients({ type: 'error', message: `[Serviço] Erro de rede ao tentar comunicar com a API da aplicação: ${error.message}` });
    } finally {
        isSendingLocationData = false; // Libera o semáforo
    }
}

// Processa dados de localização recebidos da página principal
function processLocationDataFromPage(data) {
    if (!isCurrentlyTracking || !config.deviceId || !config.serverUrl) {
        // console.log('[SW] Não configurado para rastrear ou configuração ausente, ignorando dados de localização da página.');
        return;
    }

    const now = Date.now();
    // Verifica se o tempo desde a última tentativa de envio é menor que o intervalo configurado
    if (now - lastAttemptedSendTimestamp < (config.intervalSeconds * 1000)) {
        // console.log('[SW] Throttling: envio recente, aguardando intervalo para nova tentativa.');
        return;
    }
    lastAttemptedSendTimestamp = now; // Atualiza o timestamp da última tentativa de envio
    
    // console.log('[SW] Recebido da página:', data);
    // Os dados (data) já devem vir no formato esperado pela callLogTraccarApi,
    // incluindo serverUrl e deviceId que a página obteve de seus próprios campos de input.
    // A API /api/log-traccar então usará esses serverUrl e deviceId para contatar o Traccar.
    callLogTraccarApi(data);
}


self.addEventListener('message', (event) => {
    if (!event.data || !event.data.command) return;

    const { command, data } = event.data;

    if (command === 'start-tracking') {
        // data.config contém { deviceId, serverUrl, intervalSeconds } da página
        config = { ...config, ...data.config }; 
        isCurrentlyTracking = true;
        lastAttemptedSendTimestamp = 0; // Reseta para permitir envio imediato se necessário (ex: primeira localização)
        sendMessageToClients({ type: 'tracking_status', isTracking: true, message: '[Serviço] Pronto para receber e encaminhar dados para o Traccar.' });
    } else if (command === 'stop-tracking') {
        isCurrentlyTracking = false;
        isSendingLocationData = false; // Reseta semáforo de envio
        sendMessageToClients({ type: 'tracking_status', isTracking: false, message: '[Serviço] Encaminhamento de dados para o Traccar interrompido.' });
    } else if (command === 'location-update') {
        // console.log('[SW] Comando location-update recebido:', data);
        if (isCurrentlyTracking) {
            // 'data' aqui é o payload completo vindo da página, incluindo deviceId, serverUrl, lat, lon, etc.
            processLocationDataFromPage(data);
        }
    } else if (command === 'get-status') {
        const statusMsg = isCurrentlyTracking ? '[Serviço] Encaminhamento de dados para Traccar ativo.' : '[Serviço] Encaminhamento de dados para Traccar parado.';
        sendMessageToClients({ 
            type: 'tracking_status', 
            isTracking: isCurrentlyTracking, 
            message: statusMsg 
        });
    } else if (command === 'update-config') {
        // data pode conter { intervalSeconds, serverUrl, deviceId }
        config = { ...config, ...data };
        let updateMessages = [];
        if(data.intervalSeconds !== undefined) updateMessages.push(`Intervalo para ${config.intervalSeconds}s.`);
        if(data.serverUrl !== undefined) updateMessages.push(`URL do servidor Traccar atualizada.`);
        if(data.deviceId !== undefined) updateMessages.push(`ID do dispositivo atualizado.`);
        
        sendMessageToClients({ type: 'status', message: `[Serviço] Configuração atualizada: ${updateMessages.join(' ')}`});
    }
});

self.addEventListener('install', (event) => {
    // console.log('[SW] Instalado.');
    event.waitUntil(self.skipWaiting()); // Força o SW a se tornar ativo imediatamente
});

self.addEventListener('activate', (event) => {
    // console.log('[SW] Ativado.');
    event.waitUntil(self.clients.claim()); // Permite que o SW controle clientes abertos imediatamente
});
