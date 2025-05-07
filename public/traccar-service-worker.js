'use strict';

let watchId = null;
let config = {
    deviceId: '',
    serverUrl: '',
    intervalSeconds: 10,
};
let isCurrentlyTracking = false;
let lastAttemptedSendTimestamp = 0; // Used for throttling send attempts
let isSendingLocationData = false; // Semaphore to prevent concurrent sends

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
    // sendMessageToClients({ type: 'status', message: '[SW] Tentando enviar dados para /api/log-traccar...' });

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
            sendMessageToClients({ type: 'success', message: `[SW] ${resultJson.message || 'Dados enviados com sucesso pela API.'}` });
            // lastSuccessfulSendTimestamp = Date.now(); // Only update on actual success from Traccar confirmed by action
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

function handlePositionUpdate(position) {
    if (!isCurrentlyTracking || !config.deviceId || !config.serverUrl) {
        // sendMessageToClients({ type: 'status', message: '[SW] Rastreamento não ativo ou configuração incompleta. Posição ignorada.' });
        return;
    }

    const now = Date.now();
    if (now - lastAttemptedSendTimestamp < (config.intervalSeconds * 1000)) {
        // console.log(`[SW] Throttling send. Last attempt: ${lastAttemptedSendTimestamp}, Now: ${now}, Interval: ${config.intervalSeconds}s`);
        // sendMessageToClients({ type: 'status', message: `[SW] Aguardando intervalo de ${config.intervalSeconds}s...` });
        return;
    }
    lastAttemptedSendTimestamp = now;

    const { latitude, longitude, accuracy, altitude, speed, heading } = position.coords;
    const timestamp = Math.round(position.timestamp / 1000); // UNIX timestamp in seconds

    const dataToSend = {
        serverUrl: config.serverUrl,
        deviceId: config.deviceId,
        lat: latitude,
        lon: longitude,
        timestamp: timestamp,
        ...(accuracy !== null && accuracy >= 0 && { accuracy: accuracy }),
        ...(altitude !== null && { altitude: altitude }),
        ...(speed !== null && speed >= 0 && { speed: speed }), // m/s
        ...(heading !== null && heading >= 0 && { bearing: heading }),
    };
    
    // sendMessageToClients({ type: 'status', message: `[SW] Localização obtida: ${latitude.toFixed(5)}, ${longitude.toFixed(5)}. Enviando...` });
    callLogTraccarApi(dataToSend);
}

function handlePositionError(error) {
    let errMsg = `[SW] Erro ao obter localização GPS (${error.code}): ${error.message}.`;
    switch (error.code) {
        case error.PERMISSION_DENIED:
            errMsg = "[SW] Permissão de localização negada. O rastreamento em segundo plano será interrompido.";
            stopTrackingLogic(); // Stop tracking if permission is denied
            break;
        case error.POSITION_UNAVAILABLE:
            errMsg = "[SW] Posição GPS temporariamente indisponível.";
            break;
        case error.TIMEOUT:
            errMsg = "[SW] Tempo esgotado ao tentar obter a localização GPS.";
            break;
    }
    sendMessageToClients({ type: 'error', message: errMsg });
    // Do not stop tracking for temporary errors like POSITION_UNAVAILABLE or TIMEOUT
}

function startTrackingLogic() {
    if (!('geolocation' in navigator)) {
        sendMessageToClients({ type: 'error', message: '[SW] Geolocalização não é suportada neste navegador/worker.' });
        return;
    }
    if (watchId !== null) {
        // sendMessageToClients({ type: 'status', message: '[SW] Tentativa de iniciar rastreamento que já está ativo.' });
        return;
    }

    // sendMessageToClients({ type: 'status', message: '[SW] Iniciando rastreamento no Service Worker...' });
    isCurrentlyTracking = true;
    lastAttemptedSendTimestamp = 0; // Reset timestamp to allow immediate first send attempt

    // Check for permissions first
    navigator.permissions.query({ name: 'geolocation' }).then(permissionStatus => {
        if (permissionStatus.state === 'granted') {
            watchId = navigator.geolocation.watchPosition(
                handlePositionUpdate,
                handlePositionError,
                {
                    enableHighAccuracy: true,
                    maximumAge: 0, // Don't use cached position
                    timeout: 20000, // Timeout for getting a position (20 seconds)
                }
            );
            sendMessageToClients({ type: 'tracking_status', isTracking: true, message: '[SW] Rastreamento em segundo plano iniciado.' });
        } else if (permissionStatus.state === 'prompt') {
            sendMessageToClients({ type: 'error', message: '[SW] Permissão de localização necessária. O navegador pode solicitar agora.' });
            // Attempt to trigger watchPosition anyway, it might trigger the prompt if main page can't.
            // However, SW usually cannot trigger prompts directly. Page must handle it.
             watchId = navigator.geolocation.watchPosition(
                handlePositionUpdate,
                handlePositionError,
                { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 }
            );
             // The above likely won't prompt from SW. The page needs to ensure permission first.
        } else { // denied
            sendMessageToClients({ type: 'error', message: '[SW] Permissão de localização negada. Não é possível iniciar o rastreamento.' });
            isCurrentlyTracking = false;
            sendMessageToClients({ type: 'tracking_status', isTracking: false, message: '[SW] Falha ao iniciar: permissão negada.' });
        }
        permissionStatus.onchange = () => {
            if (permissionStatus.state !== 'granted' && isCurrentlyTracking) {
                sendMessageToClients({ type: 'error', message: '[SW] Permissão de localização revogada. Parando rastreamento.' });
                stopTrackingLogic();
            }
        };
    });
}

function stopTrackingLogic() {
    if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
        // sendMessageToClients({ type: 'status', message: '[SW] Rastreamento em segundo plano parado.' });
    } else {
        // sendMessageToClients({ type: 'status', message: '[SW] Rastreamento já estava parado.' });
    }
    isCurrentlyTracking = false;
    isSendingLocationData = false; // Reset sending lock
    sendMessageToClients({ type: 'tracking_status', isTracking: false, message: '[SW] Rastreamento em segundo plano interrompido.' });
}

self.addEventListener('message', (event) => {
    if (!event.data || !event.data.command) return;

    const { command, data } = event.data;

    if (command === 'start-tracking') {
        config = { ...config, ...data }; // Update config
        // sendMessageToClients({ type: 'status', message: `[SW] Configuração recebida: ID ${config.deviceId}, URL ${config.serverUrl}, Intervalo ${config.intervalSeconds}s` });
        startTrackingLogic();
    } else if (command === 'stop-tracking') {
        stopTrackingLogic();
    } else if (command === 'get-status') {
        sendMessageToClients({ 
            type: 'tracking_status', 
            isTracking: isCurrentlyTracking, 
            message: isCurrentlyTracking ? '[SW] Rastreamento ativo.' : '[SW] Rastreamento parado.' 
        });
    } else if (command === 'update-config') {
        config = { ...config, ...data };
        sendMessageToClients({ type: 'status', message: `[SW] Configuração atualizada: Intervalo para ${config.intervalSeconds}s.`})
        // If tracking, the new interval will apply on the next send attempt due to throttling logic.
        // If watchPosition options need to change, it would need to be stopped and restarted.
        // For simplicity, intervalSeconds is used for throttling `callLogTraccarApi` calls.
    }
});

self.addEventListener('install', (event) => {
    // console.log('[SW] Service Worker instalado.');
    // sendMessageToClients({type: 'status', message: '[SW] Service Worker Instalado.'});
    event.waitUntil(self.skipWaiting()); // Force the waiting service worker to become the active service worker.
});

self.addEventListener('activate', (event) => {
    // console.log('[SW] Service Worker ativado.');
    // sendMessageToClients({type: 'status', message: '[SW] Service Worker Ativado.'});
    event.waitUntil(self.clients.claim()); // Become available to all pages controlled by this service worker.
});