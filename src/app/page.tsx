// src/app/page.tsx
'use client';

import type { NextPage } from 'next';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Play, Square, AlertCircle, WifiOff, Loader2, Settings2, XCircle, MapPin, CheckCircle2, ServerCrash } from 'lucide-react';
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
  
  const [isUiDisabled, setIsUiDisabled] = useState<boolean>(false); // Controla se a UI está desabilitada (ex: durante operações)
  const [isServiceWorkerActive, setIsServiceWorkerActive] = useState<boolean>(false); // SW está registrado e ativo?
  const [isPageTracking, setIsPageTracking] = useState<boolean>(false); // Página está ativamente capturando GPS?
  const [isSwForwarding, setIsSwForwarding] = useState<boolean>(false); // SW está configurado para encaminhar dados?

  const [statusMessage, setStatusMessage] = useState<string>('Aguardando serviço de comunicação...');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lastSuccessfulSendTime, setLastSuccessfulSendTime] = useState<string | null>(null);
  
  const serviceWorkerRef = useRef<ServiceWorkerRegistration | null>(null);
  const locationWatchIdRef = useRef<number | null>(null);
  const { toast } = useToast();
  const isMountedRef = useRef(false); // Para evitar atualizações de estado em componente desmontado

  // Função para enviar comandos ao Service Worker
  const sendCommandToSW = useCallback((command: string, data?: any) => {
    if (serviceWorkerRef.current && serviceWorkerRef.current.active) {
      serviceWorkerRef.current.active.postMessage({ command, data });
    } else {
      const swNotActiveError = "Serviço de comunicação inativo. Não foi possível executar a ação.";
      setErrorMessage(swNotActiveError);
      toast({ title: "Serviço Inativo", description: swNotActiveError, variant: "destructive"});
      setIsServiceWorkerActive(false);
    }
  }, [toast]);

  // Efeito para registrar o Service Worker e lidar com suas mensagens
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
          
          sendCommandToSW('get-status'); // Solicita status atual do SW

          navigator.serviceWorker.onmessage = (event) => {
            if (!isMountedRef.current) return;
            const { type, message, isTracking: swIsForwardingStatus, data: eventData } = event.data;
            
            switch (type) {
              case 'status':
                setStatusMessage(message);
                break;
              case 'error': // Erro reportado pelo SW (ex: falha ao chamar API)
                setErrorMessage(message);
                setStatusMessage("Erro no serviço de comunicação.");
                toast({ title: "Erro no Serviço", description: message, variant: "destructive" });
                break;
              case 'success': // Sucesso reportado pelo SW (ex: API /api/log-traccar retornou sucesso)
                const successTime = new Date().toLocaleTimeString('pt-BR');
                 // A mensagem de 'success' do SW vem da resposta da API, que já inclui o hostname.
                setStatusMessage(`[Serviço] ${message} (${successTime})`);
                setLastSuccessfulSendTime(successTime);
                setErrorMessage(null); // Limpa erros anteriores em caso de sucesso
                toast({ title: "Sucesso no Encaminhamento", description: message});
                break;
              case 'tracking_status': // Atualização sobre o estado de rastreamento/encaminhamento do SW
                setIsSwForwarding(swIsForwardingStatus);
                setStatusMessage(message || (swIsForwardingStatus ? "[Serviço] Encaminhamento ativo." : "[Serviço] Encaminhamento parado."));
                if (message && (message.toLowerCase().includes("falha") || message.toLowerCase().includes("erro"))) {
                    setErrorMessage(message);
                } else if (message && !message.toLowerCase().includes("falha") && !message.toLowerCase().includes("erro")) {
                    setErrorMessage(null); // Limpa erro se o status for positivo
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
    return () => { // Cleanup
        isMountedRef.current = false;
        if (navigator.serviceWorker && navigator.serviceWorker.onmessage) {
            navigator.serviceWorker.onmessage = null; 
        }
        if (locationWatchIdRef.current !== null) {
            navigator.geolocation.clearWatch(locationWatchIdRef.current);
            locationWatchIdRef.current = null;
        }
    };
  }, [sendCommandToSW, toast]); // Removido isPageTracking da dependência para evitar re-registros desnecessários

  // Efeito para carregar configurações do localStorage
  useEffect(() => {
    try {
      const savedDeviceId = localStorage.getItem('traccarDeviceId');
      const savedServerUrl = localStorage.getItem('traccarServerUrl');
      const savedInterval = localStorage.getItem('traccarIntervalSeconds');

      if (savedDeviceId) setDeviceId(savedDeviceId);
      
      let urlToSet = DEFAULT_SERVER_URL;
      if (savedServerUrl && savedServerUrl.trim() !== '') {
        if (isValidHttpUrl(savedServerUrl)) urlToSet = savedServerUrl;
        else { 
            console.warn("URL salva inválida, usando padrão:", savedServerUrl);
            localStorage.setItem('traccarServerUrl', DEFAULT_SERVER_URL); 
        }
      } else if (savedServerUrl === null) { // Se não existe, salva o default
        localStorage.setItem('traccarServerUrl', DEFAULT_SERVER_URL);
      }
      setServerUrl(urlToSet);

      if (savedInterval) {
        const parsedInterval = parseInt(savedInterval, 10);
        if (!isNaN(parsedInterval) && parsedInterval >= 1 && Number.isInteger(parsedInterval)) setIntervalSeconds(parsedInterval);
        else { setIntervalSeconds(10); localStorage.setItem('traccarIntervalSeconds', '10'); }
      }
    } catch (error) {
      console.error("Erro ao acessar localStorage:", error);
      const storageErrorMsg = "Não foi possível carregar configurações salvas do localStorage.";
      setErrorMessage(storageErrorMsg);
      toast({ title: "Erro de Configuração", description: storageErrorMsg, variant: "destructive" });
    }
  }, [toast]); // Executa apenas uma vez ao montar

  // Efeitos para salvar configurações no localStorage quando elas mudam
  useEffect(() => { if (deviceId.trim() !== '') localStorage.setItem('traccarDeviceId', deviceId); else localStorage.removeItem('traccarDeviceId'); }, [deviceId]);
  useEffect(() => { if (serverUrl && serverUrl.trim() !== '' && isValidHttpUrl(serverUrl)) localStorage.setItem('traccarServerUrl', serverUrl); }, [serverUrl]);
  useEffect(() => { if (!isNaN(intervalSeconds) && intervalSeconds >= 1 && Number.isInteger(intervalSeconds)) localStorage.setItem('traccarIntervalSeconds', intervalSeconds.toString()); }, [intervalSeconds]);

  // Callback para lidar com atualizações de posição GPS
  const handlePositionUpdate = useCallback((position: GeolocationPosition) => {
    if (!isMountedRef.current || !isPageTracking) return; // Processa apenas se montado e rastreando

    const { latitude, longitude, accuracy, altitude, speed, heading } = position.coords;
    const timestamp = Math.round(position.timestamp / 1000); // Timestamp em segundos

    const locationDataPayload = {
        serverUrl: serverUrl, // Pega o valor atual do estado da página
        deviceId: deviceId,   // Pega o valor atual do estado da página
        lat: latitude,
        lon: longitude,
        timestamp: timestamp,
        ...(accuracy !== null && accuracy >= 0 && { accuracy: accuracy }),
        ...(altitude !== null && { altitude: altitude }),
        ...(speed !== null && speed >= 0 && { speed: speed }), 
        ...(heading !== null && heading >= 0 && { bearing: heading }),
    };
    
    sendCommandToSW('location-update', locationDataPayload);
    
    // Atualiza status da página se não houver mensagem crítica ou de envio em andamento do SW
    if (!statusMessage.toLowerCase().includes("tentando enviar") && !statusMessage.toLowerCase().includes("encaminhando")) {
        setStatusMessage(`Localização obtida: ${latitude.toFixed(4)}, ${longitude.toFixed(4)} @ ${new Date(position.timestamp).toLocaleTimeString('pt-BR')}`);
    }

  }, [deviceId, serverUrl, sendCommandToSW, statusMessage, isPageTracking]); // Adicionado isPageTracking

  // Callback para lidar com erros de geolocalização
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
    
    if (criticalErrorForPageTracking && isPageTracking) { // Se era um erro crítico e estava rastreando
        if (locationWatchIdRef.current !== null) {
            navigator.geolocation.clearWatch(locationWatchIdRef.current);
            locationWatchIdRef.current = null;
        }
        setIsPageTracking(false); // Para rastreamento na página
        sendCommandToSW('stop-tracking'); // Pede ao SW para parar também
        setStatusMessage("Rastreamento parado: permissão de GPS negada.");
    }
  }, [sendCommandToSW, toast, isPageTracking]); // Adicionado isPageTracking

  // Solicita permissão de localização e inicia o watcher
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
        // Limpa watcher anterior se existir
        if (locationWatchIdRef.current !== null) {
          navigator.geolocation.clearWatch(locationWatchIdRef.current);
        }
        
        locationWatchIdRef.current = navigator.geolocation.watchPosition(
          (position) => { // Sucesso na obtenção da posição
            if (!isMountedRef.current) return; // Evita processar se desmontado
            
            // Só inicia de fato o rastreamento da página e SW após a primeira posição VÁLIDA
            if (!isPageTracking) { // Se ainda não estava rastreando (primeira chamada bem-sucedida)
                setIsPageTracking(true);
                setErrorMessage(null); // Limpa erros anteriores
                setStatusMessage("Rastreamento GPS ativo nesta página. Aguardando dados do serviço...");
                toast({ title: "GPS Ativado", description: "Capturando localização nesta página." });
                // Passa a config para o SW iniciar o encaminhamento
                sendCommandToSW('start-tracking', { config: { deviceId, serverUrl, intervalSeconds } });
            }
            handlePositionUpdate(position); // Envia a posição atual para o SW
            setIsUiDisabled(false);
            resolve(true);
          },
          (error) => { // Erro ao obter posição
            if (!isMountedRef.current) return;
            handlePositionError(error); // Trata o erro (pode parar o rastreamento se for crítico)
            setIsUiDisabled(false);
            resolve(false); // Permissão pode ter sido negada ou outro erro
          },
          { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 } // Opções do watchPosition
        );
      });
    } catch (error) { // Erro inesperado ao chamar watchPosition (raro)
      const queryErrorMsg = "Erro inesperado ao tentar iniciar o monitoramento de localização.";
      console.error(queryErrorMsg, error);
      setErrorMessage(queryErrorMsg);
      toast({ title: "Erro de Localização", description: queryErrorMsg, variant: "destructive" });
      setIsUiDisabled(false);
      return false;
    }
  };

  // Lida com o clique no botão "Iniciar Rastreamento"
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
      setIsUiDisabled(false); // Garante que a UI não fique bloqueada
      return;
    }
    
    setErrorMessage(null); // Limpa erros anteriores
    const permissionGrantedAndWatcherStarted = await requestLocationPermissionAndStartWatcher();
    
    if (!permissionGrantedAndWatcherStarted) {
        // A UI já deve ter sido reabilitada e mensagens de erro mostradas por requestLocationPermissionAndStartWatcher/handlePositionError
        // Se a permissão não foi dada, isPageTracking permanecerá false.
        // Se houve outro erro, ele será exibido.
    }
    // Não precisa de else setIsUiDisabled(false) aqui, pois requestLocationPermissionAndStartWatcher já cuida disso.
  };

  // Lida com o clique no botão "Parar Rastreamento"
  const handleStopTracking = () => {
    setIsUiDisabled(true); // Desabilita UI temporariamente
    setStatusMessage("Parando rastreamento GPS na página...");
    if (locationWatchIdRef.current !== null) {
      navigator.geolocation.clearWatch(locationWatchIdRef.current);
      locationWatchIdRef.current = null;
    }
    setIsPageTracking(false); // Para de rastrear na página
    sendCommandToSW('stop-tracking'); // Pede ao SW para parar o encaminhamento
    toast({ title: "Rastreamento Interrompido", description: "Captura de GPS nesta página e encaminhamento pelo serviço foram interrompidos." });
    setStatusMessage("Rastreamento interrompido. Serviço não encaminhará mais dados.");
    setLastSuccessfulSendTime(null); // Limpa o último horário de envio bem-sucedido
    setIsUiDisabled(false); // Reabilita UI
  };
  
  // Lida com a mudança no campo de intervalo
  const handleIntervalChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const valueString = e.target.value;
    if (valueString === '') { // Permite campo vazio temporariamente durante a digitação
      setIntervalSeconds(NaN); // Internamente NaN, mas UI mostra vazio
      setErrorMessage("O intervalo de envio não pode ser vazio.");
      return;
    }
    const value = parseInt(valueString, 10);
    if (!isNaN(value) && value >= 1 && Number.isInteger(value)) {
      setIntervalSeconds(value);
      setErrorMessage(null);
      // Se o SW já estiver encaminhando, atualiza sua config também
      if (isSwForwarding) { 
        sendCommandToSW('update-config', { intervalSeconds: value });
        toast({ title: "Intervalo Atualizado", description: `Serviço agora usará o novo intervalo de ${value} segundos para tentar enviar dados.` });
      }
    } else {
      setIntervalSeconds(NaN); // Mantém NaN se inválido
      const errorMsg = "Intervalo de envio inválido. Use um número inteiro (mínimo 1).";
      setErrorMessage(errorMsg);
      // Mostra toast apenas se o usuário digitou algo inválido (não se apagou tudo)
      if (valueString !== '') toast({ title: "Intervalo Inválido", description: errorMsg, variant: "destructive" });
    }
  };

  // Lida com a mudança no campo de URL do servidor
  const handleServerUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const newUrl = e.target.value;
      setServerUrl(newUrl);
      if (!newUrl || newUrl.trim() === '') {
          setErrorMessage("A URL do Servidor Traccar não pode ser vazia.");
      } else if (!isValidHttpUrl(newUrl)) {
          setErrorMessage("URL do Servidor Traccar inválida. Formato esperado: http:// ou https://");
      } else {
          setErrorMessage(null);
          // Se o SW já estiver encaminhando, atualiza sua config também
          if (isSwForwarding) {
            sendCommandToSW('update-config', { serverUrl: newUrl });
            toast({ title: "URL Atualizada", description: "Serviço agora usará a nova URL para encaminhar dados."})
          }
      }
  };
  
  // Validações para desabilitar o botão de iniciar
  const isConfigurationInvalid = 
    !deviceId || deviceId.trim() === '' ||
    !serverUrl || serverUrl.trim() === '' || !isValidHttpUrl(serverUrl) ||
    isNaN(intervalSeconds) || intervalSeconds < 1;

  // Verifica se há um erro crítico de GPS que impede o início (ex: permissão negada)
  const criticalGpsErrorOnPage = errorMessage && 
      (errorMessage.toLowerCase().includes("geolocalização não é suportada") ||
       errorMessage.toLowerCase().includes("permissão de localização negada"));

  // Lógica para desabilitar o botão Iniciar/Parar
  const startButtonShouldBeDisabled =
    !isServiceWorkerActive || // Se SW não ativo, não pode iniciar
    isUiDisabled || // Se UI já desabilitada por outra operação
    (!isPageTracking && (isConfigurationInvalid || !!criticalGpsErrorOnPage)); // Se não está rastreando E (config inválida OU erro GPS crítico)

  const isSwAttemptingSend = statusMessage.toLowerCase().includes("tentando enviar dados") || statusMessage.toLowerCase().includes("encaminhando dados");
  const isSwReportingError = errorMessage && errorMessage.toLowerCase().includes("[serviço]");
  const isSwSuccess = lastSuccessfulSendTime && !errorMessage && (isPageTracking || isSwForwarding);


  // Determina o ícone e a classe para o status
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
  } else if (isPageTracking) {
    statusIcon = <MapPin className="h-5 w-5 text-yellow-500"/>;
    statusClasses = "bg-yellow-500/10 text-yellow-600";
  }
  // Override para sucesso explícito
  if (isSwSuccess) {
     statusIcon = <CheckCircle2 className="h-5 w-5 text-green-500"/>;
     statusClasses = "bg-green-500/10 text-green-600";
  }
  // Override para erro explícito do servidor traccar (via SW)
  if (errorMessage && errorMessage.toLowerCase().includes("falha no servidor traccar")) {
      statusIcon = <ServerCrash className="h-5 w-5 text-destructive"/>;
      statusClasses = "bg-destructive/10 text-destructive";
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
                    Seu navegador pode não suportar este recurso ou pode ter ocorrido um erro durante o registro.
                    Funcionalidades como o envio de dados em segundo plano podem não funcionar.
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
            <p className="text-xs text-muted-foreground pt-1">Endereço do seu servidor Traccar (protocolo OsmAnd, geralmente porta 5055). Ex: <code>http://demo.traccar.org:5055</code></p>
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
             {/* Feedback visual dos dados enviados - pode ser uma seção separada ou integrado no status */}
            {isPageTracking && (
                <Card className="mt-4 w-full p-3 text-xs bg-card border rounded-md shadow-sm">
                    <CardTitle className="text-sm mb-1">Dados Atuais da Página (para SW):</CardTitle>
                    <p>ID: {deviceId || "N/A"}</p>
                    <p>URL: {serverUrl || "N/A"}</p>
                    <p>Intervalo SW: {isNaN(intervalSeconds) ? "N/A" : `${intervalSeconds}s`}</p>
                    {/* Aqui poderiam ser mostrados lat/lon se desejado, mas pode poluir a UI.
                        A mensagem de status já indica a lat/lon obtida. */}
                </Card>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default TraccarWebClient;
