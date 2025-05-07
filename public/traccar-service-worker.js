'use strict';

let config = {
    deviceId: '',
    serverUrl: '',
    intervalSeconds: 10, // Intervalo para o SW tentar enviar para a API
};
let isCurrentlyTracking = false; // Indica se a página principal está enviando dados
let lastAttemptedSendTimestamp = 0;
let isSendingLocationData = false; // Semáforo para envios de API

// Helper to get all clients (browser tabs/windows controlled by this SW)
async function getClients() {
    if (!self.clients) return [];
    return await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
}

// Helper to send messages to all clients
async function sendMessageToClients(messagePayload) {
    const clients = await getClients();
    clients.forEach(client => {
        client.postMessage(messagePayload);
    });
}

async function callLogTraccarApi(locationData) {
    if (isSendingLocationData) {
        // console.log('[SW] Envio de localização já em progresso, pulando.');
        return;
    }
    isSendingLocationData = true;
    sendMessageToClients({ type: 'status', message: '[SW] Tentando enviar dados para o servidor Traccar...' });

    try {
        const response = await fetch('/api/log-traccar', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(locationData),
        });

        const resultJson = await response.json();

        if (response.ok && resultJson.success) {
            sendMessageToClients({ type: 'success', message: `${resultJson.message || 'Dados enviados com sucesso pela API.'}` });
        } else {
            sendMessageToClients({ type: 'error', message: `[SW] API retornou erro (HTTP ${response.status}): ${resultJson.message || 'Erro desconhecido da API.'}` });
        }
    } catch (error) {
        // console.error('[SW] Erro de rede ao chamar API /api/log-traccar:', error);
        sendMessageToClients({ type: 'error', message: `[SW] Erro de rede ao chamar API: ${error.message}` });
    } finally {
        isSendingLocationData = false;
    }
}

// Processa dados de localização recebidos da página principal
function processLocationDataFromPage(data) {
    if (!isCurrentlyTracking || !config.deviceId || !config.serverUrl) {
        // console.log('[SW] Não rastreando ou configuração ausente, ignorando dados de localização da página.');
        return;
    }

    const now = Date.now();
    if (now - lastAttemptedSendTimestamp < (config.intervalSeconds * 1000)) {
        // console.log('[SW] Throttling: envio recente, aguardando intervalo.');
        return;
    }
    lastAttemptedSendTimestamp = now;
    
    // console.log('[SW] Recebido da página:', data);
    // Os dados já devem vir no formato esperado pela callLogTraccarApi (incluindo serverUrl e deviceId)
    // A página já deve ter adicionado serverUrl e deviceId ao payload que ela envia.
    callLogTraccarApi(data);
}


self.addEventListener('message', (event) => {
    if (!event.data || !event.data.command) return;

    const { command, data } = event.data;

    if (command === 'start-tracking') {
        config = { ...config, ...data.config };
        isCurrentlyTracking = true;
        lastAttemptedSendTimestamp = 0; // Resetar para permitir envio imediato se necessário
        sendMessageToClients({ type: 'tracking_status', isTracking: true, message: '[SW] Pronto para receber e encaminhar dados.' });
    } else if (command === 'stop-tracking') {
        isCurrentlyTracking = false;
        isSendingLocationData = false; // Resetar semáforo de envio
        sendMessageToClients({ type: 'tracking_status', isTracking: false, message: '[SW] Encaminhamento de dados interrompido.' });
    } else if (command === 'location-update') {
        // console.log('[SW] Comando location-update recebido:', data);
        if (isCurrentlyTracking) {
            processLocationDataFromPage(data);
        }
    } else if (command === 'get-status') {
        const statusMsg = isCurrentlyTracking ? '[SW] Encaminhamento de dados ativo.' : '[SW] Encaminhamento de dados parado.';
        sendMessageToClients({ 
            type: 'tracking_status', 
            isTracking: isCurrentlyTracking, 
            message: statusMsg 
        });
    } else if (command === 'update-config') {
        config = { ...config, ...data };
        sendMessageToClients({ type: 'status', message: `[SW] Config. atualizada: Intervalo para ${config.intervalSeconds}s.`});
    }
});

self.addEventListener('install', (event) => {
    event.waitUntil(self.skipWaiting()); 
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim()); 
});
