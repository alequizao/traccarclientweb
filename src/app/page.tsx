// src/app/page.tsx
'use client';

import type { NextPage } from 'next';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Play, Square, AlertCircle, WifiOff, Loader2, XCircle, MapPin, CheckCircle2, ServerCrash } from 'lucide-react';
import { useToast } from "@/hooks/use-toast";

const DEFAULT_SERVER_URL = 'http://65.21.243.46:5055'; // URL Padrão Traccar

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
  const [hasMounted, setHasMounted] = useState(false);

  useEffect(() => {
    setHasMounted(true);
  }, []);

  const sendCommandToSW = useCallback((command: string, data?: any) => {
    if (serviceWorkerRef.current && serviceWorkerRef.current.active) {
      serviceWorkerRef.current.active.postMessage({ command, data });
    } else {
      const swNotActiveError = "Serviço de comunicação inativo. Não foi possível executar a ação.";
      if(hasMounted) { // Only show error/toast if component is fully mounted
        setErrorMessage(swNotActiveError);
        toast({ title: "Serviço Inativo", description: swNotActiveError, variant: "destructive"});
      }
      setIsServiceWorkerActive(false);
    }
  }, [toast, hasMounted]);

  useEffect(() => {
    if (!hasMounted) return; // Wait for client mount

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
                setStatusMessage("Erro no serviço de comunicação.");
                toast({ title: "Erro no Serviço", description: message, variant: "destructive" });
                break;
              case 'success':
                const successTime = new Date().toLocaleTimeString('pt-BR');
                setStatusMessage(`[Serviço] ${message} (${successTime})`);
                setLastSuccessfulSendTime(successTime);
                setErrorMessage(null);
                toast({ title: "Sucesso no Encaminhamento", description: message});
                break;
              case 'tracking_status':
                setIsSwForwarding(swIsForwardingStatus);
                setStatusMessage(message || (swIsForwardingStatus ? "[Serviço] Encaminhamento ativo." : "[Serviço] Encaminhamento parado."));
                if (message && (message.toLowerCase().includes("falha") || message.toLowerCase().includes("erro"))) {
                    setErrorMessage(message);
                } else if (message && !message.toLowerCase().includes("falha") && !message.toLowerCase().includes("erro")) {
                    setErrorMessage(null);
                }
                break;
              default:
                // console.log("[Página] Mensagem SW desconhecida:", event.data);
            }
          };
        })
        .catch(error => {
          if (!isMountedRef.current) return;
          console.error('Falha ao registrar Service Worker:', error);
          const swErrorMsg = "Falha crítica ao registrar serviço de comunicação. Funcionalidades podem estar limitadas ou indisponíveis.";
          setErrorMessage(swErrorMsg);
          setStatusMessage("Serviço de comunicação indisponível.");
          toast({ title: "Erro Crítico de Serviço", description: swErrorMsg, variant: "destructive" });
          setIsServiceWorkerActive(false);
        });
    } else {
      if (!isMountedRef.current) return;
      const noSwSupportMsg = "Service Workers não são suportados neste navegador. O rastreamento em segundo plano pode não funcionar como esperado.";
      setErrorMessage(noSwSupportMsg);
      setStatusMessage("Navegador incompatível com algumas funcionalidades.");
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
  }, [sendCommandToSW, toast, hasMounted]);

  useEffect(() => {
    if (!hasMounted) return; // Only load from localStorage after client mount

    try {
      const savedDeviceId = localStorage.getItem('traccarDeviceId');
      if (savedDeviceId) {
        setDeviceId(savedDeviceId);
      }

      const savedServerUrl = localStorage.getItem('traccarServerUrl');
      if (savedServerUrl && isValidHttpUrl(savedServerUrl)) {
        setServerUrl(savedServerUrl);
      } // else, it keeps the initial DEFAULT_SERVER_URL or what was set by user

      const savedInterval = localStorage.getItem('traccarIntervalSeconds');
      if (savedInterval) {
        const parsedInterval = parseInt(savedInterval, 10);
        if (!isNaN(parsedInterval) && parsedInterval >= 1 && Number.isInteger(parsedInterval)) {
          setIntervalSeconds(parsedInterval);
        } // else, it keeps the initial 10 or what was set by user
      }
    } catch (error) {
      console.error("Erro ao acessar localStorage:", error);
      toast({ title: "Erro de Configuração", description: "Não foi possível carregar configurações salvas.", variant: "destructive" });
    }
  }, [hasMounted, toast]);

  useEffect(() => { if (hasMounted && deviceId.trim() !== '') localStorage.setItem('traccarDeviceId', deviceId); else if (hasMounted) localStorage.removeItem('traccarDeviceId'); }, [deviceId, hasMounted]);
  useEffect(() => { if (hasMounted && serverUrl && serverUrl.trim() !== '' && isValidHttpUrl(serverUrl)) localStorage.setItem('traccarServerUrl', serverUrl); }, [serverUrl, hasMounted]);
  useEffect(() => { if (hasMounted && !isNaN(intervalSeconds) && intervalSeconds >= 1 && Number.isInteger(intervalSeconds)) localStorage.setItem('traccarIntervalSeconds', intervalSeconds.toString()); }, [intervalSeconds, hasMounted]);


  const handlePositionUpdate = useCallback((position: GeolocationPosition) => {
    if (!isMountedRef.current || !isPageTracking) return;

    const { latitude, longitude, accuracy, altitude, speed, heading } = position.coords;
    const timestamp = Math.round(Date.now() / 1000); // Use Date.now() for current timestamp

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
    
    if (!statusMessage.toLowerCase().includes("tentando enviar") && !statusMessage.toLowerCase().includes("encaminhando")) {
        setStatusMessage(`Localização obtida: ${latitude.toFixed(4)}, ${longitude.toFixed(4)} @ ${new Date().toLocaleTimeString('pt-BR')}`);
    }

  }, [deviceId, serverUrl, sendCommandToSW, statusMessage, isPageTracking]);

  const handlePositionError = useCallback((error: GeolocationPositionError) => {
    if (!isMountedRef.current) return;
    let errMsg = `[GPS da Página] Erro (${error.code}): ${error.message}.`;
    let criticalErrorForPageTracking = false;
    switch (error.code) {
        case error.PERMISSION_DENIED:
            errMsg = "[GPS da Página] Permissão de localização negada. O rastreamento não pode iniciar ou continuar.";
            criticalErrorForPageTracking = true;
            break;
        case error.POSITION_UNAVAILABLE:
            errMsg = "[GPS da Página] Posição indisponível. Verifique o sinal do GPS ou as configurações de localização do dispositivo.";
            break;
        case error.TIMEOUT:
            errMsg = "[GPS da Página] Tempo esgotado ao obter localização.";
            break;
    }
    setErrorMessage(errMsg);
    toast({ title: "Erro de GPS", description: errMsg, variant: "destructive" });
    
    if (criticalErrorForPageTracking && isPageTracking) {
        if (locationWatchIdRef.current !== null) {
            navigator.geolocation.clearWatch(locationWatchIdRef.current);
            locationWatchIdRef.current = null;
        }
        setIsPageTracking(false);
        sendCommandToSW('stop-tracking');
        setStatusMessage("Rastreamento parado: permissão de GPS negada.");
    }
  }, [sendCommandToSW, toast, isPageTracking]);

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
      return new Promise<boolean>((resolve) => {
        if (locationWatchIdRef.current !== null) {
          navigator.geolocation.clearWatch(locationWatchIdRef.current);
        }
        
        locationWatchIdRef.current = navigator.geolocation.watchPosition(
          (position) => {
            if (!isMountedRef.current) return;
            
            if (!isPageTracking) {
                setIsPageTracking(true);
                setErrorMessage(null);
                setStatusMessage("Rastreamento GPS ativo nesta página. Aguardando dados do serviço...");
                toast({ title: "GPS Ativado", description: "Capturando localização nesta página." });
                sendCommandToSW('start-tracking', { config: { deviceId, serverUrl, intervalSeconds } });
            }
            handlePositionUpdate(position);
            setIsUiDisabled(false);
            resolve(true);
          },
          (error) => {
            if (!isMountedRef.current) return;
            handlePositionError(error);
            setIsUiDisabled(false);
            resolve(false);
          },
          { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 }
        );
      });
    } catch (error) {
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
      setErrorMessage(`URL do Servidor Traccar inválida: ${serverUrl}. Formato esperado: http:// ou https://`); toast({ title: "URL Inválida", description: "Insira uma URL de servidor Traccar válida.", variant: "destructive" }); hasError = true;
    }
    if (isNaN(intervalSeconds) || !Number.isInteger(intervalSeconds) || intervalSeconds < 1) {
      setErrorMessage("Intervalo de envio inválido. Deve ser um número inteiro maior ou igual a 1."); toast({ title: "Intervalo Inválido", description: "Insira um intervalo válido (número >= 1).", variant: "destructive" }); hasError = true;
    }
    if (!isServiceWorkerActive) {
      setErrorMessage("Serviço de comunicação não está ativo. Tente recarregar a página."); toast({ title: "Serviço Inativo", description: "O serviço de comunicação não iniciou corretamente.", variant: "destructive" }); hasError = true;
    }

    if (hasError) {
      setIsUiDisabled(false);
      return;
    }
    
    setErrorMessage(null);
    const permissionGrantedAndWatcherStarted = await requestLocationPermissionAndStartWatcher();
    // UI disable/enable is handled within requestLocationPermissionAndStartWatcher
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
    toast({ title: "Rastreamento Interrompido", description: "Captura de GPS e encaminhamento interrompidos." });
    setStatusMessage("Rastreamento interrompido. Serviço não encaminhará mais dados.");
    setLastSuccessfulSendTime(null);
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
        toast({ title: "Intervalo Atualizado", description: `Serviço agora usará o novo intervalo de ${value} segundos.` });
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
          setErrorMessage("A URL do Servidor Traccar não pode ser vazia.");
      } else if (!isValidHttpUrl(newUrl)) {
          setErrorMessage("URL do Servidor Traccar inválida. Formato esperado: http:// ou https://");
      } else {
          setErrorMessage(null);
          if (isSwForwarding) {
            sendCommandToSW('update-config', { serverUrl: newUrl });
            toast({ title: "URL Atualizada", description: "Serviço agora usará a nova URL."})
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
    !hasMounted || // Disable until component is mounted to prevent hydration issues with localStorage
    !isServiceWorkerActive ||
    isUiDisabled ||
    (!isPageTracking && (isConfigurationInvalid || !!criticalGpsErrorOnPage));

  const isSwAttemptingSend = statusMessage.toLowerCase().includes("tentando enviar dados") || statusMessage.toLowerCase().includes("encaminhando dados");
  const isSwSuccess = lastSuccessfulSendTime && !errorMessage && (isPageTracking || isSwForwarding);

  let statusIcon = <WifiOff className="h-5 w-5"/>;
  let statusClasses = "bg-muted text-muted-foreground";

  if (errorMessage) {
    statusIcon = <XCircle className="h-5 w-5"/>;
    statusClasses = "bg-destructive/10 text-destructive";
  } else if (isSwAttemptingSend) {
    statusIcon = <Loader2 className="h-5 w-5 animate-spin text-accent"/>;
    statusClasses = "bg-accent/10 text-accent";
  } else if (isPageTracking && isSwForwarding) {
    statusIcon = <MapPin className="h-5 w-5 animate-pulse text-green-500"/>;
    statusClasses = "bg-green-500/10 text-green-600";
  } else if (isPageTracking && !isSwForwarding && isServiceWorkerActive) { // Page tracking, SW ready but not forwarding yet (e.g. initial state)
    statusIcon = <MapPin className="h-5 w-5 text-yellow-500"/>;
    statusClasses = "bg-yellow-500/10 text-yellow-600";
  } else if (!isServiceWorkerActive && hasMounted) { // Service worker failed or not supported
    statusIcon = <WifiOff className="h-5 w-5 text-destructive" />;
    statusClasses = "bg-destructive/10 text-destructive";
  }


  if (isSwSuccess) {
     statusIcon = <CheckCircle2 className="h-5 w-5 text-green-500"/>;
     statusClasses = "bg-green-500/10 text-green-600";
  }
  if (errorMessage && errorMessage.toLowerCase().includes("falha no servidor traccar")) {
      statusIcon = <ServerCrash className="h-5 w-5 text-destructive"/>;
      statusClasses = "bg-destructive/10 text-destructive";
  }

  if (!hasMounted) {
    // Render a loading state or null to prevent hydration mismatch
    // For inputs, their initial state values will be used by SSR.
    // We disable the start button until mounted.
    return (
        <div className="min-h-screen bg-background flex items-center justify-center p-4 font-sans">
            <Card className="w-full max-w-md shadow-xl rounded-xl border">
                <CardHeader className="p-6">
                    <CardTitle className="text-2xl font-bold text-center text-foreground">Cliente Web Traccar</CardTitle>
                </CardHeader>
                <CardContent className="p-6 flex justify-center items-center">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </CardContent>
            </Card>
        </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4 font-sans">
      <Card className="w-full max-w-md shadow-xl rounded-xl border">
        <CardHeader className="p-6">
          <CardTitle className="text-2xl font-bold text-center text-foreground">Cliente Web Traccar</CardTitle>
          <CardDescription className="text-center text-muted-foreground pt-1">
            Rastreamento GPS com encaminhamento por Service Worker.
            <br />
            <span className="text-xs font-semibold text-destructive">O rastreamento pode parar se a aba/navegador for fechado ou o sistema operacional restringir processos em segundo plano.</span>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6 p-6">
          {!isServiceWorkerActive && !errorMessage?.includes("Falha crítica") && ( 
            <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Serviço de Comunicação Indisponível</AlertTitle>
                <AlertDescription>
                    O serviço de comunicação em segundo plano (Service Worker) não está ativo.
                    Recarregue a página. Se o problema persistir, seu navegador pode não suportar este recurso.
                </AlertDescription>
            </Alert>
          )}
          {errorMessage && (
            <Alert variant="destructive" className="rounded-md">
              <XCircle className="h-4 w-4" />
              <AlertTitle>Mensagem de Erro</AlertTitle>
              <AlertDescription>{errorMessage}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <Label htmlFor="deviceId" className="font-medium">ID do Dispositivo</Label>
            <Input id="deviceId" placeholder="Insira um ID único para este dispositivo" value={deviceId} onChange={(e) => setDeviceId(e.target.value)} disabled={isPageTracking || isUiDisabled} className="bg-card rounded-md shadow-sm" aria-required="true"/>
            <p className="text-xs text-muted-foreground pt-1">Este ID será usado para identificar seu dispositivo no servidor Traccar.</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="serverUrl" className="font-medium">URL do Servidor Traccar</Label>
            <Input id="serverUrl" placeholder="Ex: http://seu.servidor.com:5055" value={serverUrl} onChange={handleServerUrlChange} disabled={isPageTracking || isUiDisabled} type="url" className={`bg-card rounded-md shadow-sm ${errorMessage?.toLowerCase().includes('url do servidor') ? 'border-destructive ring-destructive' : ''}`} aria-required="true"/>
            <p className="text-xs text-muted-foreground pt-1">Endereço do seu servidor Traccar (protocolo OsmAnd, geralmente porta 5055). Ex: <code>{DEFAULT_SERVER_URL}</code></p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="interval" className="font-medium">Intervalo de Envio do Serviço (segundos)</Label>
            <Input id="interval" type="number" min="1" step="1" placeholder="Mínimo 1 segundo" value={isNaN(intervalSeconds) ? '' : intervalSeconds} onChange={handleIntervalChange} disabled={isUiDisabled} className={`bg-card rounded-md shadow-sm ${errorMessage?.toLowerCase().includes('intervalo') || isNaN(intervalSeconds) ? 'border-destructive ring-destructive' : ''}`} aria-required="true"/>
            <p className="text-xs text-muted-foreground pt-1">Frequência (em segundos) com que o serviço tentará enviar os dados de localização para o servidor.</p>
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

            <div role="status" aria-live="polite" className={`flex items-center space-x-2 py-2 px-4 rounded-full text-sm font-medium transition-colors duration-200 ${statusClasses}`}>
              {statusIcon}
              <span className="truncate max-w-xs">{statusMessage}</span>
            </div>
            {lastSuccessfulSendTime && (isPageTracking || isSwForwarding) && !errorMessage?.toLowerCase().includes("falha no servidor traccar") && (
                <p className="text-xs text-green-600 font-medium">Último envio com sucesso: {lastSuccessfulSendTime}</p>
            )}
            {(isPageTracking || isSwForwarding) && (
                <Card className="mt-4 w-full p-3 text-xs bg-card border rounded-md shadow-sm">
                    <CardTitle className="text-sm mb-1">Configuração Atual para Envio:</CardTitle>
                    <p>ID do Dispositivo: <span className="font-semibold">{deviceId || "Não definido"}</span></p>
                    <p>URL do Servidor: <span className="font-semibold">{serverUrl || "Não definida"}</span></p>
                    <p>Intervalo do Serviço: <span className="font-semibold">{isNaN(intervalSeconds) ? "Inválido" : `${intervalSeconds}s`}</span></p>
                    <p className="mt-1 text-muted-foreground">Status GPS Página: {isPageTracking ? <span className="text-green-600">Ativo</span> : <span className="text-yellow-600">Inativo</span>}</p>
                    <p className="text-muted-foreground">Status Encaminhamento SW: {isSwForwarding ? <span className="text-green-600">Ativo</span> : <span className="text-yellow-600">Inativo</span>}</p>
                </Card>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default TraccarWebClient;
