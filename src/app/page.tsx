'use client';

import type { NextPage } from 'next';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Play, Square, AlertCircle, WifiOff, Loader2, Settings2, XCircle, MapPin } from 'lucide-react';
import { useToast } from "@/hooks/use-toast";

const DEFAULT_SERVER_URL = 'http://65.21.243.46:5055';

const isValidHttpUrl = (string: string): boolean => {
  try {
    const url = new URL(string);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch (_) {
    return false;
  }
};

const TraccarWebClient: NextPage = () => {
  const [deviceId, setDeviceId] = useState<string>('');
  const [serverUrl, setServerUrl] = useState<string>(DEFAULT_SERVER_URL);
  const [intervalSeconds, setIntervalSeconds] = useState<number>(10);
  
  const [isUiDisabled, setIsUiDisabled] = useState<boolean>(false);
  const [isServiceWorkerActive, setIsServiceWorkerActive] = useState<boolean>(false);
  const [isPageTracking, setIsPageTracking] = useState<boolean>(false);
  const [isSwForwarding, setIsSwForwarding] = useState<boolean>(false);

  const [statusMessage, setStatusMessage] = useState<string>('Aguardando serviço de comunicação...');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lastSuccessfulSendTime, setLastSuccessfulSendTime] = useState<string | null>(null);
  
  const serviceWorkerRef = useRef<ServiceWorkerRegistration | null>(null);
  const locationWatchIdRef = useRef<number | null>(null);
  const { toast } = useToast();
  const isMountedRef = useRef(false);

  const sendCommandToSW = useCallback((command: string, data?: any) => {
    if (serviceWorkerRef.current && serviceWorkerRef.current.active) {
      serviceWorkerRef.current.active.postMessage({ command, data });
    } else {
      const swNotActiveError = "Serviço de comunicação inativo. Não foi possível executar a ação.";
      setErrorMessage(swNotActiveError);
      toast({ title: "Serviço Inativo", description: swNotActiveError, variant: "destructive"});
      setIsServiceWorkerActive(false); // Ensure UI reflects this
    }
  }, [toast]);

  useEffect(() => {
    isMountedRef.current = true;
    if ('serviceWorker' in navigator) {
      const swFile = '/traccar-service-worker.js';
      navigator.serviceWorker.register(swFile)
        .then(registration => {
          if (!isMountedRef.current) return;
          serviceWorkerRef.current = registration;
          setIsServiceWorkerActive(true);
          setStatusMessage('Serviço de comunicação registrado. Verificando status...');
          toast({ title: "Serviço Registrado", description: "Serviço de comunicação pronto." });
          
          sendCommandToSW('get-status');

          navigator.serviceWorker.onmessage = (event) => {
            if (!isMountedRef.current) return;
            const { type, message, isTracking: swIsForwardingStatus } = event.data;
            
            switch (type) {
              case 'status':
                setStatusMessage(message);
                break;
              case 'error':
                setErrorMessage(message);
                setStatusMessage(prev => prev.includes("Iniciando") || prev.includes("Verificando") ? "Falha na operação do serviço." : "Erro no serviço de comunicação.");
                toast({ title: "Erro no Serviço", description: message, variant: "destructive" });
                break;
              case 'success':
                const successTime = new Date().toLocaleTimeString();
                setStatusMessage(`[Serviço] ${message} (${successTime})`);
                setLastSuccessfulSendTime(successTime);
                setErrorMessage(null);
                toast({ title: "Sucesso", description: message });
                break;
              case 'tracking_status':
                setIsSwForwarding(swIsForwardingStatus);
                if(isPageTracking && !swIsForwardingStatus && message && !message.toLowerCase().includes("pronto para receber")){
                    setStatusMessage(message || "Encaminhamento de dados parado pelo serviço.");
                } else if (swIsForwardingStatus && message.toLowerCase().includes("pronto para receber")){
                    setStatusMessage(message || "Serviço pronto para encaminhar dados.");
                } else if (message) { // General status update from SW
                    setStatusMessage(message);
                }
                if (message && (message.toLowerCase().includes("falha") || message.toLowerCase().includes("erro"))) {
                    setErrorMessage(message);
                }
                break;
              default:
                // console.log("Mensagem SW desconhecida:", event.data);
            }
          };
        })
        .catch(error => {
          if (!isMountedRef.current) return;
          console.error('Falha ao registrar Service Worker:', error);
          const swErrorMsg = "Falha crítica ao registrar serviço de comunicação. Funcionalidades limitadas.";
          setErrorMessage(swErrorMsg);
          setStatusMessage("Serviço de comunicação indisponível.");
          toast({ title: "Erro Crítico de Serviço", description: swErrorMsg, variant: "destructive" });
          setIsServiceWorkerActive(false);
        });
    } else {
      if (!isMountedRef.current) return;
      const noSwSupportMsg = "Service Workers não são suportados neste navegador. Algumas funcionalidades podem estar limitadas.";
      setErrorMessage(noSwSupportMsg);
      setStatusMessage("Navegador incompatível.");
      toast({ title: "Navegador Incompatível", description: noSwSupportMsg, variant: "destructive" });
      setIsServiceWorkerActive(false);
    }
    return () => {
        isMountedRef.current = false;
        if (navigator.serviceWorker && navigator.serviceWorker.onmessage) {
            navigator.serviceWorker.onmessage = null; 
        }
        if (locationWatchIdRef.current !== null) {
            navigator.geolocation.clearWatch(locationWatchIdRef.current);
            locationWatchIdRef.current = null;
        }
    };
  }, [sendCommandToSW, toast, isPageTracking]);

  useEffect(() => {
    try {
      const savedDeviceId = localStorage.getItem('traccarDeviceId');
      const savedServerUrl = localStorage.getItem('traccarServerUrl');
      const savedInterval = localStorage.getItem('traccarIntervalSeconds');

      if (savedDeviceId) setDeviceId(savedDeviceId);
      
      let urlToSet = DEFAULT_SERVER_URL;
      if (savedServerUrl) {
        if (isValidHttpUrl(savedServerUrl) && savedServerUrl.trim() !== '') urlToSet = savedServerUrl;
        else { console.warn("URL salva inválida, usando padrão:", savedServerUrl); localStorage.setItem('traccarServerUrl', DEFAULT_SERVER_URL); }
      } else { localStorage.setItem('traccarServerUrl', DEFAULT_SERVER_URL); }
      setServerUrl(urlToSet);

      if (savedInterval) {
        const parsedInterval = parseInt(savedInterval, 10);
        if (!isNaN(parsedInterval) && parsedInterval >= 1 && Number.isInteger(parsedInterval)) setIntervalSeconds(parsedInterval);
        else { setIntervalSeconds(10); localStorage.setItem('traccarIntervalSeconds', '10'); }
      }
    } catch (error) {
      console.error("Erro ao acessar localStorage:", error);
      setErrorMessage("Não foi possível carregar configurações salvas.");
      toast({ title: "Erro de Configuração", description: "Não foi possível ler as configurações salvas.", variant: "destructive" });
    }
  }, [toast]);

  useEffect(() => { if (deviceId.trim() !== '') localStorage.setItem('traccarDeviceId', deviceId); else localStorage.removeItem('traccarDeviceId'); }, [deviceId]);
  useEffect(() => { if (serverUrl && serverUrl.trim() !== '' && isValidHttpUrl(serverUrl)) localStorage.setItem('traccarServerUrl', serverUrl); }, [serverUrl]);
  useEffect(() => { if (!isNaN(intervalSeconds) && intervalSeconds >= 1 && Number.isInteger(intervalSeconds)) localStorage.setItem('traccarIntervalSeconds', intervalSeconds.toString()); }, [intervalSeconds]);


  const handlePositionUpdate = useCallback((position: GeolocationPosition) => {
    if (!isMountedRef.current) return;

    const { latitude, longitude, accuracy, altitude, speed, heading } = position.coords;
    const timestamp = Math.round(position.timestamp / 1000);

    const locationDataPayload = {
        serverUrl: serverUrl,
        deviceId: deviceId,
        lat: latitude,
        lon: longitude,
        timestamp: timestamp,
        ...(accuracy !== null && accuracy >= 0 && { accuracy: accuracy }),
        ...(altitude !== null && { altitude: altitude }),
        ...(speed !== null && speed >= 0 && { speed: speed }), 
        ...(heading !== null && heading >= 0 && { bearing: heading }),
    };
    
    sendCommandToSW('location-update', locationDataPayload);
    // Only update status if not currently showing an attempt to send from SW
    if (!statusMessage.includes("Tentando enviar")) {
        setStatusMessage(`Localização obtida: ${latitude.toFixed(4)}, ${longitude.toFixed(4)} @ ${new Date(position.timestamp).toLocaleTimeString()}`);
    }

  }, [deviceId, serverUrl, sendCommandToSW, statusMessage]);

  const handlePositionError = useCallback((error: GeolocationPositionError) => {
    if (!isMountedRef.current) return;
    let errMsg = `[GPS Página] Erro (${error.code}): ${error.message}.`;
    let criticalErrorForPageTracking = false;
    switch (error.code) {
        case error.PERMISSION_DENIED:
            errMsg = "[GPS Página] Permissão de localização negada. O rastreamento não pode iniciar/continuar.";
            criticalErrorForPageTracking = true;
            break;
        case error.POSITION_UNAVAILABLE:
            errMsg = "[GPS Página] Posição indisponível. Verifique o sinal do GPS ou as configurações de localização do dispositivo.";
            break;
        case error.TIMEOUT:
            errMsg = "[GPS Página] Tempo esgotado ao obter localização.";
            break;
    }
    setErrorMessage(errMsg);
    toast({ title: "Erro de GPS", description: errMsg, variant: "destructive" });
    
    if (criticalErrorForPageTracking) {
        if (locationWatchIdRef.current !== null) {
            navigator.geolocation.clearWatch(locationWatchIdRef.current);
            locationWatchIdRef.current = null;
        }
        setIsPageTracking(false);
        sendCommandToSW('stop-tracking');
        setStatusMessage("Rastreamento parado: permissão de GPS negada.");
    }
  }, [sendCommandToSW, toast]);


  const requestLocationPermissionAndStartWatcher = async (): Promise<boolean> => {
    if (!('geolocation' in navigator)) {
      const noGeoMsg = "Geolocalização não é suportada neste navegador.";
      setErrorMessage(noGeoMsg);
      toast({ title: "GPS Não Suportado", description: noGeoMsg, variant: "destructive" });
      return false;
    }

    setIsUiDisabled(true);
    setStatusMessage("Solicitando permissão de localização...");

    try {
      // Try direct watchPosition for permission prompt as it's more standard
      // Fallback to getCurrentPosition if watchPosition doesn't prompt
      return new Promise<boolean>((resolve) => {
        locationWatchIdRef.current = navigator.geolocation.watchPosition(
          (position) => { // Success, permission likely granted or already was
            if (!isMountedRef.current) return;
            handlePositionUpdate(position);
            setIsPageTracking(true);
            setErrorMessage(null);
            setStatusMessage("Rastreamento GPS ativo nesta página.");
            toast({ title: "GPS Ativado", description: "Capturando localização nesta página." });
            sendCommandToSW('start-tracking', { config: { deviceId, serverUrl, intervalSeconds } });
            setIsUiDisabled(false);
            resolve(true);
          },
          (error) => { // Error, could be permission denied
            if (!isMountedRef.current) return;
            handlePositionError(error); // This will set error message and toast
            // If it was a fatal error (like PERMISSION_DENIED), handlePositionError already stops tracking.
            setIsUiDisabled(false);
            resolve(false);
          },
          { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 } // timeout for each position attempt
        );
      });
    } catch (error) { // Should not happen with modern browsers for watchPosition itself
      const queryErrorMsg = "Erro inesperado ao tentar iniciar o monitoramento de localização.";
      console.error(queryErrorMsg, error);
      setErrorMessage(queryErrorMsg);
      toast({ title: "Erro de Localização", description: queryErrorMsg, variant: "destructive" });
      setIsUiDisabled(false);
      return false;
    }
  };


  const handleStartTracking = async () => {
    let hasError = false;
    if (!deviceId || deviceId.trim() === '') {
      setErrorMessage("Configure o ID do Dispositivo."); toast({ title: "Configuração Incompleta", description: "Insira um ID do Dispositivo.", variant: "destructive" }); hasError = true;
    }
    if (!serverUrl || serverUrl.trim() === '' || !isValidHttpUrl(serverUrl)) {
      setErrorMessage(`URL do Servidor inválida: ${serverUrl}. Use http:// ou https://.`); toast({ title: "URL Inválida", description: "Insira uma URL de servidor válida.", variant: "destructive" }); hasError = true;
    }
    if (isNaN(intervalSeconds) || !Number.isInteger(intervalSeconds) || intervalSeconds < 1) {
      setErrorMessage("Intervalo de envio inválido. Deve ser um número inteiro >= 1."); toast({ title: "Intervalo Inválido", description: "Insira um intervalo válido (número >= 1).", variant: "destructive" }); hasError = true;
    }
    if (!isServiceWorkerActive) {
      setErrorMessage("Serviço de comunicação não está ativo. Tente recarregar a página."); toast({ title: "Serviço Inativo", description: "O serviço de comunicação não iniciou.", variant: "destructive" }); hasError = true;
    }

    if (hasError) {
      setIsUiDisabled(false);
      return;
    }
    
    setErrorMessage(null); // Clear previous errors
    const permissionGrantedAndWatcherStarted = await requestLocationPermissionAndStartWatcher();
    if (!permissionGrantedAndWatcherStarted) {
        setIsUiDisabled(false);
    }
  };

  const handleStopTracking = () => {
    setIsUiDisabled(true);
    setStatusMessage("Parando rastreamento GPS na página...");
    if (locationWatchIdRef.current !== null) {
      navigator.geolocation.clearWatch(locationWatchIdRef.current);
      locationWatchIdRef.current = null;
    }
    setIsPageTracking(false);
    sendCommandToSW('stop-tracking');
    toast({ title: "Rastreamento Interrompido", description: "Captura de GPS e encaminhamento pelo serviço interrompidos." });
    setStatusMessage("Rastreamento interrompido.");
    // setLastSuccessfulSendTime(null); // Optionally clear last send time
    setIsUiDisabled(false);
  };
  
  const handleIntervalChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const valueString = e.target.value;
    if (valueString === '') {
      setIntervalSeconds(NaN); 
      setErrorMessage("O intervalo de envio não pode ser vazio.");
      return;
    }
    const value = parseInt(valueString, 10);
    if (!isNaN(value) && value >= 1 && Number.isInteger(value)) {
      setIntervalSeconds(value);
      setErrorMessage(null);
      if (isSwForwarding) {
        sendCommandToSW('update-config', { intervalSeconds: value });
        toast({ title: "Intervalo Atualizado", description: `Serviço usará novo intervalo de ${value}s.` });
      }
    } else {
      setIntervalSeconds(NaN);
      const errorMsg = "Intervalo de envio inválido. Use um número inteiro (mínimo 1).";
      setErrorMessage(errorMsg);
      if (valueString !== '') toast({ title: "Intervalo Inválido", description: errorMsg, variant: "destructive" });
    }
  };

  const handleServerUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const newUrl = e.target.value;
      setServerUrl(newUrl);
      if (!newUrl || newUrl.trim() === '') {
          setErrorMessage("A URL do Servidor não pode ser vazia.");
      } else if (!isValidHttpUrl(newUrl)) {
          setErrorMessage("URL do Servidor inválida. Formato: http:// ou https://");
      } else {
          setErrorMessage(null);
          if (isSwForwarding) { // If SW is forwarding, update its config also
            sendCommandToSW('update-config', { serverUrl: newUrl });
          }
      }
  };
  
  const isConfigurationInvalid = 
    !deviceId || deviceId.trim() === '' ||
    !serverUrl || serverUrl.trim() === '' || !isValidHttpUrl(serverUrl) ||
    isNaN(intervalSeconds) || intervalSeconds < 1;

  const criticalGpsErrorOnPage = errorMessage && 
      (errorMessage.toLowerCase().includes("geolocalização não é suportada") ||
       errorMessage.toLowerCase().includes("permissão de localização negada"));

  const startButtonShouldBeDisabled =
    !isServiceWorkerActive ||
    isUiDisabled ||
    (!isPageTracking && (isConfigurationInvalid || !!criticalGpsErrorOnPage));

  const isSwAttemptingSend = statusMessage.includes("Tentando enviar dados");

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4 font-sans">
      <Card className="w-full max-w-md shadow-xl rounded-xl border">
        <CardHeader className="p-6">
          <CardTitle className="text-2xl font-bold text-center text-foreground">Cliente Web Traccar</CardTitle>
          <CardDescription className="text-center text-muted-foreground pt-1">
            Rastreamento GPS com encaminhamento por Service Worker.
            <br />
            <span className="text-xs font-semibold text-destructive">O rastreamento pode parar se a aba/navegador for fechado ou o sistema operacional restringir.</span>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6 p-6">
          {!isServiceWorkerActive && !errorMessage?.includes("Falha crítica") && ( 
            <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Serviço Indisponível</AlertTitle>
                <AlertDescription>
                    O serviço de comunicação em segundo plano não está ativo.
                    Seu navegador pode não suportar ou pode haver um erro.
                </AlertDescription>
            </Alert>
          )}
          {errorMessage && (
            <Alert variant="destructive" className="rounded-md">
              <XCircle className="h-4 w-4" />
              <AlertTitle>Erro</AlertTitle>
              <AlertDescription>{errorMessage}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <Label htmlFor="deviceId" className="font-medium">ID do Dispositivo</Label>
            <Input id="deviceId" placeholder="Insira um ID único" value={deviceId} onChange={(e) => setDeviceId(e.target.value)} disabled={isPageTracking || isUiDisabled} className="bg-card rounded-md shadow-sm" aria-required="true"/>
            <p className="text-xs text-muted-foreground pt-1">Identificador para o servidor Traccar.</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="serverUrl" className="font-medium">URL do Servidor Traccar</Label>
            <Input id="serverUrl" placeholder="Ex: http://seu.servidor.com:5055" value={serverUrl} onChange={handleServerUrlChange} disabled={isPageTracking || isUiDisabled} type="url" className={`bg-card rounded-md shadow-sm ${errorMessage?.includes('URL do Servidor inválida') ? 'border-destructive ring-destructive' : ''}`} aria-required="true"/>
            <p className="text-xs text-muted-foreground pt-1">Protocolo OsmAnd (porta 5055). Ex: <code>http://demo.traccar.org:5055</code></p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="interval" className="font-medium">Intervalo de Envio do Serviço (segundos)</Label>
            <Input id="interval" type="number" min="1" step="1" placeholder="Mínimo 1 segundo" value={isNaN(intervalSeconds) ? '' : intervalSeconds} onChange={handleIntervalChange} disabled={isUiDisabled} className={`bg-card rounded-md shadow-sm ${errorMessage?.includes('Intervalo inválido') || isNaN(intervalSeconds) ? 'border-destructive ring-destructive' : ''}`} aria-required="true"/>
            <p className="text-xs text-muted-foreground pt-1">Frequência que o serviço tentará enviar dados (mínimo 1s).</p>
          </div>
          
          <div className="flex flex-col items-center space-y-4 pt-2">
            <Button
              onClick={isPageTracking ? handleStopTracking : handleStartTracking}
              className={`w-full text-lg py-3 rounded-md shadow-md transition-colors duration-200 ${
                isPageTracking ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90' : 'bg-primary text-primary-foreground hover:bg-primary/90'
              }`}
              aria-label={isPageTracking ? 'Parar Rastreamento GPS' : 'Iniciar Rastreamento GPS'}
              disabled={startButtonShouldBeDisabled} 
            >
              {isUiDisabled ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : (isPageTracking ? <Square className="mr-2 h-5 w-5" /> : <Play className="mr-2 h-5 w-5" />)}
              {isUiDisabled ? (statusMessage.includes("Solicitando") ? 'Solicitando Permissão...' : 'Processando...') : (isPageTracking ? 'Parar Rastreamento' : 'Iniciar Rastreamento')}
            </Button>

            <div role="status" aria-live="polite" className={`flex items-center space-x-2 py-2 px-4 rounded-full text-sm font-medium transition-colors duration-200 ${
                errorMessage ? 'bg-destructive/10 text-destructive' : (isPageTracking || isSwForwarding ? 'bg-accent/10 text-accent' : 'bg-muted text-muted-foreground')
            }`}>
              { errorMessage ? <XCircle className="h-5 w-5"/> : 
                (isSwAttemptingSend ? <Loader2 className="h-5 w-5 animate-spin text-accent" /> : 
                  (isPageTracking && isSwForwarding ? <MapPin className="h-5 w-5 animate-pulse text-green-500"/> : 
                    (isPageTracking ? <MapPin className="h-5 w-5 text-yellow-500"/> : 
                      <WifiOff className="h-5 w-5"/>
                    )
                  )
                ) 
              }
              <span className="truncate max-w-xs">{statusMessage}</span>
            </div>
            {lastSuccessfulSendTime && !errorMessage && (isPageTracking || isSwForwarding) && (
                <p className="text-xs text-muted-foreground">Último envio com sucesso: {lastSuccessfulSendTime}</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default TraccarWebClient;
