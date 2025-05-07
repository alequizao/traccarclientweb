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

function handlePositionUpdate(position) {
    if (!isCurrentlyTracking || !config.deviceId || !config.serverUrl) {
        return;
    }

    const now = Date.now();
    if (now - lastAttemptedSendTimestamp < (config.intervalSeconds * 1000)) {
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
    
    callLogTraccarApi(dataToSend);
}

function handlePositionError(error) {
    let errMsg = `[SW] Erro ao obter localização GPS (${error.code}): ${error.message}.`;
    let criticalError = false;
    switch (error.code) {
        case error.PERMISSION_DENIED:
            errMsg = "[SW] Permissão de localização negada. O rastreamento em segundo plano será interrompido.";
            criticalError = true;
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
    if (criticalError) {
        isCurrentlyTracking = false;
        sendMessageToClients({ type: 'tracking_status', isTracking: false, message: errMsg });
    }
}

function startTrackingLogic() {
    if (!('geolocation' in navigator)) {
        const errorMsg = '[SW] Geolocalização não é suportada neste navegador/worker. O rastreamento em segundo plano não pode ser iniciado.';
        sendMessageToClients({ type: 'error', message: errorMsg });
        isCurrentlyTracking = false; 
        sendMessageToClients({ type: 'tracking_status', isTracking: false, message: errorMsg });
        return;
    }
    if (watchId !== null) {
        return;
    }

    isCurrentlyTracking = true;
    lastAttemptedSendTimestamp = 0; 

    navigator.permissions.query({ name: 'geolocation' }).then(permissionStatus => {
        if (permissionStatus.state === 'granted') {
            watchId = navigator.geolocation.watchPosition(
                handlePositionUpdate,
                handlePositionError,
                {
                    enableHighAccuracy: true,
                    maximumAge: 0, 
                    timeout: 20000, 
                }
            );
            sendMessageToClients({ type: 'tracking_status', isTracking: true, message: '[SW] Rastreamento em segundo plano iniciado.' });
        } else if (permissionStatus.state === 'prompt') {
            const promptMsg = '[SW] Permissão de localização necessária. A página principal deve solicitar a permissão.';
            sendMessageToClients({ type: 'error', message: promptMsg });
            // Attempting to watchPosition here from SW usually doesn't trigger user prompt.
            // Page needs to ensure permission is granted first.
            // We will set tracking to false as it effectively cannot start without permission.
            isCurrentlyTracking = false;
            sendMessageToClients({ type: 'tracking_status', isTracking: false, message: '[SW] Falha ao iniciar: permissão pendente. Solicite na página.' });
        } else { // denied
            const deniedMsg = '[SW] Permissão de localização negada. Não é possível iniciar o rastreamento.';
            sendMessageToClients({ type: 'error', message: deniedMsg });
            isCurrentlyTracking = false;
            sendMessageToClients({ type: 'tracking_status', isTracking: false, message: deniedMsg });
        }
        
        permissionStatus.onchange = () => {
            if (permissionStatus.state !== 'granted' && isCurrentlyTracking) {
                const revokedMsg = '[SW] Permissão de localização revogada. Parando rastreamento.';
                sendMessageToClients({ type: 'error', message: revokedMsg });
                stopTrackingLogic(); // This will send its own tracking_status update
            } else if (permissionStatus.state === 'granted' && !isCurrentlyTracking && config.deviceId && config.serverUrl) {
                // If permission was just granted and we were not tracking (e.g. stuck in prompt state)
                // and we have config, try to start.
                // This is an edge case, typically start is initiated by explicit command.
                // For now, let's keep it simple: user needs to click "Start" again if permission was granted later.
            }
        };
    }).catch(error => {
        // Error querying permissions
        const permErrorMsg = `[SW] Erro ao verificar permissões de localização: ${error.message}. Não é possível iniciar.`;
        sendMessageToClients({ type: 'error', message: permErrorMsg });
        isCurrentlyTracking = false;
        sendMessageToClients({ type: 'tracking_status', isTracking: false, message: permErrorMsg });
    });
}

function stopTrackingLogic() {
    if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
    }
    isCurrentlyTracking = false;
    isSendingLocationData = false; 
    sendMessageToClients({ type: 'tracking_status', isTracking: false, message: '[SW] Rastreamento em segundo plano interrompido.' });
}

self.addEventListener('message', (event) => {
    if (!event.data || !event.data.command) return;

    const { command, data } = event.data;

    if (command === 'start-tracking') {
        config = { ...config, ...data }; 
        startTrackingLogic();
    } else if (command === 'stop-tracking') {
        stopTrackingLogic();
    } else if (command === 'get-status') {
        // Send a more detailed status, especially if an error condition prevented starting
        let statusMsg = isCurrentlyTracking ? '[SW] Rastreamento ativo.' : '[SW] Rastreamento parado.';
        if (!isCurrentlyTracking && !('geolocation' in navigator)) {
            statusMsg = '[SW] Falha crítica: Geolocalização indisponível no worker.';
        }
        // We could also check permission status here, but it's async and might be complex.
        // The startTrackingLogic handles most permission issues.
        sendMessageToClients({ 
            type: 'tracking_status', 
            isTracking: isCurrentlyTracking, 
            message: statusMsg 
        });
    } else if (command === 'update-config') {
        config = { ...config, ...data };
        sendMessageToClients({ type: 'status', message: `[SW] Configuração atualizada: Intervalo para ${config.intervalSeconds}s.`})
    }
});

self.addEventListener('install', (event) => {
    event.waitUntil(self.skipWaiting()); 
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim()); 
});