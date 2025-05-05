"use client";

import type { NextPage } from 'next';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Play, Square, AlertCircle, Wifi, WifiOff } from 'lucide-react';
import { useToast } from "@/hooks/use-toast";

const DEFAULT_SERVER_URL = 'http://65.21.243.46:5055'; // Default URL as requested

const TraccarWebClient: NextPage = () => {
  const [deviceId, setDeviceId] = useState<string>('');
  const [serverUrl, setServerUrl] = useState<string>(DEFAULT_SERVER_URL); // Set default server URL
  const [intervalSeconds, setIntervalSeconds] = useState<number>(10);
  const [isTracking, setIsTracking] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>('Parado');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const intervalIdRef = useRef<NodeJS.Timeout | null>(null);
  const { toast } = useToast();

  // Load config from localStorage on mount
  useEffect(() => {
    try {
        const savedDeviceId = localStorage.getItem('traccarDeviceId');
        const savedServerUrl = localStorage.getItem('traccarServerUrl');
        const savedInterval = localStorage.getItem('traccarIntervalSeconds');

        if (savedDeviceId) setDeviceId(savedDeviceId);
        // Only overwrite default if a saved URL exists and is not empty
        if (savedServerUrl && savedServerUrl.trim() !== '') {
           setServerUrl(savedServerUrl);
        } else {
           // If no saved URL or it's empty, ensure default is set (redundant but safe)
           setServerUrl(DEFAULT_SERVER_URL);
           // Also save the default back to localStorage if it wasn't set
           localStorage.setItem('traccarServerUrl', DEFAULT_SERVER_URL);
        }
        if (savedInterval) {
            const parsedInterval = parseInt(savedInterval, 10);
            if (!isNaN(parsedInterval) && parsedInterval > 0) {
              setIntervalSeconds(parsedInterval);
            }
        }
    } catch (error) {
        console.error("Erro ao acessar localStorage:", error);
        setErrorMessage("Não foi possível carregar as configurações salvas. O LocalStorage pode estar indisponível.");
    }
  }, []);

  // Save config to localStorage when inputs change
  useEffect(() => {
    try {
        // Don't save if deviceId is empty to avoid issues on first load
        if (deviceId.trim() !== '') {
            localStorage.setItem('traccarDeviceId', deviceId);
        }
    } catch (error) {
        console.error("Erro ao salvar deviceId no localStorage:", error);
    }
  }, [deviceId]);

  useEffect(() => {
     try {
        // Don't save if serverUrl is empty
        if (serverUrl.trim() !== '') {
           localStorage.setItem('traccarServerUrl', serverUrl);
        }
     } catch (error) {
         console.error("Erro ao salvar serverUrl no localStorage:", error);
     }
  }, [serverUrl]);

  useEffect(() => {
    // Only save valid positive integers
    if (!isNaN(intervalSeconds) && intervalSeconds > 0 && Number.isInteger(intervalSeconds)) {
      try {
        localStorage.setItem('traccarIntervalSeconds', intervalSeconds.toString());
      } catch (error) {
        console.error("Erro ao salvar intervalSeconds no localStorage:", error);
      }
    }
  }, [intervalSeconds]);

  // Cleanup interval on unmount or when tracking stops
  useEffect(() => {
    return () => {
      if (intervalIdRef.current) {
        clearInterval(intervalIdRef.current);
        intervalIdRef.current = null;
      }
    };
  }, []);

  const sendLocationData = useCallback(async (position: GeolocationPosition) => {
    if (!deviceId || !serverUrl) {
      setErrorMessage("ID do Dispositivo e URL do Servidor são obrigatórios.");
      setIsTracking(false);
      setStatusMessage("Parado - Configuração necessária");
      if (intervalIdRef.current) clearInterval(intervalIdRef.current);
      intervalIdRef.current = null;
      return;
    }

    const { latitude, longitude, accuracy, altitude, speed, heading } = position.coords;
    const timestamp = Math.round(position.timestamp / 1000); // Convert ms to seconds

    // Basic URL validation
    let validatedUrl: URL;
    try {
        validatedUrl = new URL(serverUrl);
        if (!['http:', 'https:'].includes(validatedUrl.protocol)) {
            throw new Error("Protocolo inválido. Use http ou https.");
        }
    } catch (e) {
        const errMsg = e instanceof Error ? e.message : "URL inválida";
        setErrorMessage(`URL do Servidor inválida: ${serverUrl}. ${errMsg}`);
        setIsTracking(false);
        setStatusMessage("Erro de Configuração");
        if (intervalIdRef.current) clearInterval(intervalIdRef.current);
        intervalIdRef.current = null;
        return;
    }

    const params = new URLSearchParams({
      id: deviceId,
      lat: latitude.toString(),
      lon: longitude.toString(),
      timestamp: timestamp.toString(),
    });

    // Add optional parameters if they are available and valid
    if (accuracy !== null) params.append('accuracy', accuracy.toString());
    if (altitude !== null) params.append('altitude', altitude.toString());
    // Ensure speed is non-negative before sending
    if (speed !== null && speed >= 0) params.append('speed', speed.toString());
    // Ensure heading is non-negative before sending
    if (heading !== null && heading >= 0) params.append('bearing', heading.toString());

    // Construct the URL - OsmAnd protocol usually targets the root path of the specified port.
    const urlWithParams = `${validatedUrl.origin}/?${params.toString()}`;


    setStatusMessage(`Enviando localização... (${latitude.toFixed(5)}, ${longitude.toFixed(5)})`);
    setErrorMessage(null); // Clear previous errors on successful attempt

    try {
      const response = await fetch(urlWithParams, {
        method: 'POST', // Traccar typically expects POST for osmand protocol
        // Keep headers commented out unless server requires them
        // headers: {
        //   'Content-Type': 'application/x-www-form-urlencoded', // fetch usually sets this automatically for URLSearchParams
        // },
        // Ensure no 'mode: no-cors' as it hides errors
      });

      if (response.ok) {
          // console.log('Location sent successfully');
          toast({
              title: "Localização Enviada",
              description: `Dados enviados para ${validatedUrl.origin}`,
          });
      } else {
          const statusText = response.statusText || `Código ${response.status}`;
          console.error("Falha ao enviar localização - Resposta não OK:", response.status, statusText, response.url);
          let detailedError = `Falha ao enviar localização: ${statusText}. Verifique URL e o estado do servidor Traccar.`;
          // Specific hint for common 400/404 errors or others
          if (response.status === 400) detailedError += " (Bad Request - Dados inválidos?).";
          if (response.status === 404) detailedError += " (Not Found - Endpoint errado?).";
          // Note: Browser might still hide CORS details even if 'no-cors' isn't used.
          detailedError += ' Se persistir, verifique a configuração CORS do servidor.';

          setErrorMessage(detailedError);
          setStatusMessage("Erro no Envio");
          toast({
              title: "Erro no Envio",
              description: `Falha ao enviar dados: ${statusText}`,
              variant: "destructive",
          });
      }

    } catch (error) {
        console.error("Falha ao enviar localização (Fetch Error):", error);
        // Improve error message for fetch failures (likely network or CORS preflight)
        let errMsg = 'Erro ao conectar ao servidor.';
        if (error instanceof TypeError && error.message.toLowerCase().includes('failed to fetch')) {
           // This specific TypeError is highly indicative of Network or CORS issues
           errMsg = `Falha na conexão: Verifique a conexão com a internet, a URL do servidor (${urlWithParams}), e crucialmente, se o servidor Traccar (${validatedUrl.origin}) está configurado para aceitar requisições desta origem (CORS).`;
        } else if (error instanceof Error) {
           errMsg = `Erro inesperado: ${error.message}`; // Use the specific error message if available
        } else {
           errMsg = 'Erro desconhecido ao tentar enviar dados.';
        }

        setErrorMessage(errMsg);
        setStatusMessage("Erro na Conexão");
         toast({
            title: "Erro de Conexão",
            description: "Não foi possível conectar ao servidor. Verifique a rede e a configuração CORS.", // Simpler toast
            variant: "destructive",
        });
    }
  }, [deviceId, serverUrl, toast]); // Removed intervalSeconds as it's not directly used here

  const handleTracking = useCallback(() => {
    if (!('geolocation' in navigator)) {
        setErrorMessage("Geolocalização não é suportada por este navegador.");
        setIsTracking(false);
        setStatusMessage("GPS Não Suportado");
        if (intervalIdRef.current) clearInterval(intervalIdRef.current);
        intervalIdRef.current = null;
         toast({
            title: "GPS Não Suportado",
            description: "Geolocalização não é suportada por este navegador.",
            variant: "destructive",
        });
        return; // Exit early if geolocation is not available
    }

    // Define error handler function separately
    const handleGeoError = (error: GeolocationPositionError) => {
        console.error("Erro ao obter localização:", error);
        let errMsg = `Erro de GPS: ${error.message} (Código: ${error.code}).`;
        switch (error.code) {
            case error.PERMISSION_DENIED:
                errMsg += " Permissão negada. Habilite a localização para este site nas configurações do navegador.";
                break;
            case error.POSITION_UNAVAILABLE:
                errMsg += " Posição não disponível. Verifique se o GPS está ativado e com boa recepção.";
                break;
            case error.TIMEOUT:
                errMsg += " Tempo esgotado para obter a localização.";
                break;
            default:
                 errMsg += " Erro desconhecido ao obter localização.";
                 break;
        }

        setErrorMessage(errMsg);
        setIsTracking(false); // Stop tracking if location fetch fails
        setStatusMessage("Erro de GPS");
        if (intervalIdRef.current) clearInterval(intervalIdRef.current);
        intervalIdRef.current = null;
         toast({
            title: "Erro de GPS",
            description: errMsg,
            variant: "destructive",
        });
    };

    // Define success handler function separately
    const handleGeoSuccess = (position: GeolocationPosition) => {
        sendLocationData(position); // Send immediately on success
    };

    // Request current position
    setStatusMessage('Obtendo localização...'); // Indicate we're trying to get GPS
    navigator.geolocation.getCurrentPosition(
        handleGeoSuccess,
        handleGeoError,
        {
            enableHighAccuracy: true,
            maximumAge: 0, // Force fresh data
            timeout: 15000, // Increased timeout to 15 seconds
        }
    );

  }, [sendLocationData, toast]);

  const startTracking = useCallback(() => {
    // Validation checks
    if (!deviceId || !serverUrl) {
      setErrorMessage("ID do Dispositivo e URL do Servidor devem ser configurados antes de iniciar.");
      toast({
        title: "Configuração Incompleta",
        description: "Por favor, insira o ID do Dispositivo e a URL do Servidor.",
        variant: "destructive",
      });
      return;
    }
     if (isNaN(intervalSeconds) || !Number.isInteger(intervalSeconds) || intervalSeconds <= 0) {
      setErrorMessage("O intervalo deve ser um número inteiro positivo de segundos.");
       toast({
        title: "Intervalo Inválido",
        description: "O intervalo de rastreamento deve ser um número inteiro positivo.",
        variant: "destructive",
      });
      return;
    }

    // Basic URL validation before starting
    try {
        const validatedUrl = new URL(serverUrl);
        if (!['http:', 'https:'].includes(validatedUrl.protocol)) {
           throw new Error("Protocolo inválido.");
        }
    } catch (_) {
        setErrorMessage(`URL do Servidor inválida: ${serverUrl}. Use http:// ou https://`);
        toast({
            title: "URL Inválida",
            description: "Por favor, insira uma URL válida para o servidor (http:// ou https://).",
            variant: "destructive",
        });
        return;
    }


    // Check geolocation support again before starting interval
    if (!('geolocation' in navigator)) {
       setErrorMessage("Geolocalização não é suportada por este navegador. Não é possível iniciar o rastreamento.");
       toast({
           title: "GPS Não Suportado",
           description: "Não é possível iniciar o rastreamento sem suporte à geolocalização do navegador.",
           variant: "destructive",
       });
       return;
    }


    setIsTracking(true);
    setStatusMessage("Iniciando...");
    setErrorMessage(null); // Clear any previous errors

    handleTracking(); // Attempt initial send immediately

    // Clear existing interval before setting a new one, just in case
    if (intervalIdRef.current) {
      clearInterval(intervalIdRef.current);
    }

    // Set up the interval timer
    intervalIdRef.current = setInterval(handleTracking, intervalSeconds * 1000);

    toast({
        title: "Rastreamento Iniciado",
        description: `Enviando localização a cada ${intervalSeconds} segundos.`,
    });

  }, [deviceId, serverUrl, intervalSeconds, handleTracking, toast]);

  const stopTracking = useCallback(() => {
    setIsTracking(false);
    setStatusMessage("Parado");
    setErrorMessage(null); // Clear errors when stopped
    if (intervalIdRef.current) {
      clearInterval(intervalIdRef.current);
      intervalIdRef.current = null;
    }
    toast({
        title: "Rastreamento Parado",
    });
  }, [toast]);

  const handleIntervalChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const valueString = e.target.value;
    // Allow empty input temporarily, use NaN to indicate invalid state
    if (valueString === '') {
        setIntervalSeconds(NaN);
        setErrorMessage("O intervalo não pode ser vazio."); // Provide immediate feedback
        return;
    }

    const value = parseInt(valueString, 10);

    // Only update state if it's a positive integer
    if (!isNaN(value) && value >= 1 && Number.isInteger(value)) {
      setIntervalSeconds(value);
      setErrorMessage(null); // Clear error message if input becomes valid
       // If tracking is active, immediately restart the interval with the new value
       if (isTracking) {
         if (intervalIdRef.current) clearInterval(intervalIdRef.current);
         // Only set new interval if the value is valid
         intervalIdRef.current = setInterval(handleTracking, value * 1000);
         toast({
             title: "Intervalo Atualizado",
             description: `Agora enviando localização a cada ${value} segundos.`,
         });
       }
    } else {
        // Keep NaN state but show error and toast
        setIntervalSeconds(NaN);
        const errorMsg = "O intervalo deve ser um número inteiro positivo maior que zero.";
        setErrorMessage(errorMsg);
        toast({
            title: "Intervalo Inválido",
            description: errorMsg,
            variant: "destructive",
        });
        // Stop interval if tracking and interval becomes invalid
        if (isTracking && intervalIdRef.current) {
            clearInterval(intervalIdRef.current);
            intervalIdRef.current = null;
            setStatusMessage("Intervalo Inválido - Rastreamento Pausado");
        }
    }
  };


  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4 font-sans">
      <Card className="w-full max-w-md shadow-lg rounded-xl border">
        <CardHeader className="p-6">
          <CardTitle className="text-2xl font-bold text-center text-foreground">Cliente Web Traccar</CardTitle>
          <CardDescription className="text-center text-muted-foreground pt-1">
            Envie a localização do seu navegador para o servidor Traccar.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6 p-6">
          {errorMessage && (
            <Alert variant="destructive" className="rounded-md">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Erro</AlertTitle>
              <AlertDescription>{errorMessage}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <Label htmlFor="deviceId" className="font-medium">Identificador do Dispositivo</Label>
            <Input
              id="deviceId"
              placeholder="Insira um ID único para o dispositivo"
              value={deviceId}
              onChange={(e) => setDeviceId(e.target.value)}
              disabled={isTracking}
              className="bg-card rounded-md shadow-sm"
              aria-required="true"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="serverUrl" className="font-medium">URL do Servidor Traccar</Label>
            <Input
              id="serverUrl"
              placeholder="Ex: http://seu.servidor.com:5055" // More specific placeholder
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              disabled={isTracking}
              type="url"
              className="bg-card rounded-md shadow-sm"
              aria-required="true"
            />
             <p className="text-xs text-muted-foreground pt-1">Use protocolo HTTP ou HTTPS. Porta padrão OsmAnd: 5055. Verifique CORS no servidor.</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="interval" className="font-medium">Intervalo de Rastreamento (segundos)</Label>
            <Input
              id="interval"
              type="number"
              min="1"
              step="1" // Ensure whole numbers
              placeholder="Mínimo 1 segundo" // Placeholder for interval
              value={isNaN(intervalSeconds) ? '' : intervalSeconds} // Show empty string if NaN
              onChange={handleIntervalChange}
              className={`bg-card rounded-md shadow-sm ${isNaN(intervalSeconds) ? 'border-destructive ring-destructive' : ''}`} // Indicate error on input
              aria-required="true"
              aria-invalid={isNaN(intervalSeconds)} // Mark as invalid if NaN
            />
          </div>

          <div className="flex flex-col items-center space-y-4 pt-2">
             <Button
              onClick={isTracking ? stopTracking : startTracking}
              className={`w-full text-lg py-3 rounded-md shadow-md transition-colors duration-200 ${
                  isTracking
                  ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
                  : 'bg-primary text-primary-foreground hover:bg-primary/90'
               }`}
              aria-label={isTracking ? 'Parar Rastreamento' : 'Iniciar Rastreamento'}
              disabled={isTracking ? false : (isNaN(intervalSeconds) || !deviceId || !serverUrl)} // Disable start if config invalid or interval is NaN
            >
              {isTracking ? <Square className="mr-2 h-5 w-5" /> : <Play className="mr-2 h-5 w-5" />}
              {isTracking ? 'Parar Rastreamento' : 'Iniciar Rastreamento'}
            </Button>

             <div className={`flex items-center space-x-2 py-2 px-4 rounded-full text-sm font-medium transition-colors duration-200 ${
                 errorMessage
                 ? 'bg-destructive/10 text-destructive'
                 : isTracking
                 ? 'bg-accent/10 text-accent'
                 : 'bg-muted text-muted-foreground'
              }`}>
              { errorMessage ? <AlertCircle className="h-5 w-5"/> : (isTracking ? <Wifi className="h-5 w-5"/> : <WifiOff className="h-5 w-5"/>) }
              <span className="truncate max-w-xs">{statusMessage}</span> {/* Prevent long status messages from breaking layout */}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default TraccarWebClient;

    