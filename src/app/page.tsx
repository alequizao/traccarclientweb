'use client';

import type { NextPage } from 'next';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Play, Square, AlertCircle, Wifi, WifiOff, Loader2 } from 'lucide-react';
import { useToast } from "@/hooks/use-toast";
import { sendTraccarData, type SendTraccarDataInput } from './actions'; // Importa a Server Action

// URL padrão do servidor Traccar
const DEFAULT_SERVER_URL = 'http://65.21.243.46:5055'; // URL padrão ajustada

const TraccarWebClient: NextPage = () => {
  // Estados do componente
  const [deviceId, setDeviceId] = useState<string>(''); // Identificador único do dispositivo
  const [serverUrl, setServerUrl] = useState<string>(DEFAULT_SERVER_URL); // URL do servidor Traccar
  const [intervalSeconds, setIntervalSeconds] = useState<number>(10); // Intervalo de envio em segundos
  const [isTracking, setIsTracking] = useState<boolean>(false); // Indica se o rastreamento está ativo
  const [isSending, setIsSending] = useState<boolean>(false); // Indica se uma requisição está em andamento
  const [statusMessage, setStatusMessage] = useState<string>('Parado'); // Mensagem de status para o usuário
  const [errorMessage, setErrorMessage] = useState<string | null>(null); // Mensagem de erro para o usuário
  const intervalIdRef = useRef<NodeJS.Timeout | null>(null); // Referência para o ID do intervalo
  const { toast } = useToast(); // Hook para exibir notificações (toasts)

  // Efeito para carregar configurações do localStorage ao montar o componente
  useEffect(() => {
    try {
      const savedDeviceId = localStorage.getItem('traccarDeviceId');
      const savedServerUrl = localStorage.getItem('traccarServerUrl');
      const savedInterval = localStorage.getItem('traccarIntervalSeconds');

      if (savedDeviceId) setDeviceId(savedDeviceId);

      // Define a URL do servidor, usando o padrão se não houver valor salvo ou se estiver vazio/inválido
      let urlToSet = DEFAULT_SERVER_URL;
      if (savedServerUrl) {
        try {
          new URL(savedServerUrl); // Testa se a URL salva é válida
          if (savedServerUrl.trim() !== '') {
             urlToSet = savedServerUrl;
          }
        } catch (e) {
          console.warn("URL do servidor salva inválida, usando padrão:", savedServerUrl);
          localStorage.setItem('traccarServerUrl', DEFAULT_SERVER_URL); // Corrige URL inválida no storage
        }
      } else {
         localStorage.setItem('traccarServerUrl', DEFAULT_SERVER_URL); // Salva o padrão se não existir
      }
      setServerUrl(urlToSet);


      // Define o intervalo, validando o valor salvo
      if (savedInterval) {
        const parsedInterval = parseInt(savedInterval, 10);
        if (!isNaN(parsedInterval) && parsedInterval >= 1 && Number.isInteger(parsedInterval)) {
          setIntervalSeconds(parsedInterval);
        } else {
          // Se o valor salvo for inválido, reseta para o padrão 10 e atualiza localStorage
          setIntervalSeconds(10);
          localStorage.setItem('traccarIntervalSeconds', '10');
        }
      }
    } catch (error) {
      console.error("Erro ao acessar localStorage:", error);
      setErrorMessage("Não foi possível carregar as configurações salvas. O LocalStorage pode estar indisponível ou bloqueado.");
      toast({ title: "Erro de Configuração", description: "Não foi possível ler as configurações salvas.", variant: "destructive" });
    }
  }, [toast]); // Adicionado toast como dependência

  // Efeitos para salvar configurações no localStorage sempre que mudarem
  useEffect(() => {
    try {
      if (deviceId.trim() !== '') {
        localStorage.setItem('traccarDeviceId', deviceId);
      } else {
        localStorage.removeItem('traccarDeviceId'); // Remove se estiver vazio
      }
    } catch (error) {
      console.error("Erro ao salvar ID do Dispositivo no localStorage:", error);
       toast({ title: "Erro ao Salvar", description: "Não foi possível salvar o ID do dispositivo.", variant: "destructive" });
    }
  }, [deviceId, toast]);

  useEffect(() => {
    try {
       // Salva apenas se for uma URL válida
       if (serverUrl) {
           new URL(serverUrl); // Testa se é válida antes de salvar
           if (serverUrl.trim() !== '') {
               localStorage.setItem('traccarServerUrl', serverUrl);
           }
       }
    } catch (error) {
      // Não salva URL inválida e notifica o usuário (opcionalmente)
      console.warn("Tentativa de salvar URL inválida:", serverUrl, error);
      // toast({ title: "URL Inválida", description: "A URL do servidor não foi salva por ser inválida.", variant: "destructive" });
    }
  }, [serverUrl, toast]);


  useEffect(() => {
    // Salva apenas se for um número inteiro válido e positivo
    if (!isNaN(intervalSeconds) && intervalSeconds >= 1 && Number.isInteger(intervalSeconds)) {
      try {
        localStorage.setItem('traccarIntervalSeconds', intervalSeconds.toString());
      } catch (error) {
        console.error("Erro ao salvar Intervalo no localStorage:", error);
        toast({ title: "Erro ao Salvar", description: "Não foi possível salvar o intervalo.", variant: "destructive" });
      }
    }
  }, [intervalSeconds, toast]);

  // Efeito para limpar o intervalo ao desmontar o componente ou parar o rastreamento
  useEffect(() => {
    return () => {
      if (intervalIdRef.current) {
        clearInterval(intervalIdRef.current);
        intervalIdRef.current = null;
      }
    };
  }, []);

  // Função para parar o rastreamento (usada no botão e em erros graves)
  const stopTracking = useCallback(() => {
    setIsTracking(false);
    setStatusMessage("Parado");
    setErrorMessage(null); // Limpa erros ao parar manualmente
    if (intervalIdRef.current) {
      clearInterval(intervalIdRef.current);
      intervalIdRef.current = null;
    }
    setIsSending(false); // Garante que o estado de envio seja resetado
    // Não mostrar toast se chamado internamente por erro
    // toast({ title: "Rastreamento Parado" });
  }, []); // Sem dependências externas de callbacks

  // Função para enviar dados de localização usando a Server Action
  const sendLocationData = useCallback(async (position: GeolocationPosition) => {
    // Validação básica dos dados necessários no cliente antes de enviar para a action
    if (!deviceId || !serverUrl) {
      setErrorMessage("ID do Dispositivo e URL do Servidor são obrigatórios.");
      setIsTracking(false);
      setStatusMessage("Parado - Configuração Incompleta");
      if (intervalIdRef.current) clearInterval(intervalIdRef.current);
      intervalIdRef.current = null;
      return;
    }

    // Validação básica do formato da URL no cliente
    let validatedUrl: URL;
    try {
      validatedUrl = new URL(serverUrl);
      if (!['http:', 'https:'].includes(validatedUrl.protocol)) {
        throw new Error("Protocolo inválido. Use http:// ou https://");
      }
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : "URL inválida";
      setErrorMessage(`URL do Servidor inválida: ${serverUrl}. Detalhe: ${errMsg}`);
      setIsTracking(false);
      setStatusMessage("Erro de Configuração");
      if (intervalIdRef.current) clearInterval(intervalIdRef.current);
      intervalIdRef.current = null;
      return;
    }

    const { latitude, longitude, accuracy, altitude, speed, heading } = position.coords;
    const timestamp = Math.round(position.timestamp / 1000); // Timestamp UNIX em segundos

    // Prepara os dados para a Server Action
    const dataToSend: SendTraccarDataInput = {
      serverUrl: validatedUrl.toString(), // Usa a URL validada
      deviceId,
      lat: latitude,
      lon: longitude,
      timestamp: timestamp,
      // Inclui dados opcionais apenas se disponíveis e válidos
      ...(accuracy !== null && accuracy >= 0 && { accuracy: accuracy }),
      ...(altitude !== null && { altitude: altitude }),
      ...(speed !== null && speed >= 0 && { speed: speed }), // Velocidade em m/s (a conversão para nós é feita na Action)
      ...(heading !== null && heading >= 0 && { bearing: heading }), // 'bearing' é o heading
    };

    setStatusMessage(`Enviando localização... (${latitude.toFixed(5)}, ${longitude.toFixed(5)})`);
    setErrorMessage(null); // Limpa erros anteriores
    setIsSending(true); // Indica que o envio começou

    try {
      // Chama a Server Action
      const result = await sendTraccarData(dataToSend);

      if (result.success) {
        // Sucesso no envio
        toast({
          title: "Localização Enviada",
          description: `Dados enviados com sucesso para ${new URL(serverUrl).hostname}.`,
        });
        setStatusMessage(`Último envio: ${new Date().toLocaleTimeString()}`);
      } else {
        // Falha no envio (erro retornado pela Server Action)
        console.error("Server Action Error:", result.message);
        const detailedError = `Falha no envio (servidor): ${result.message || 'Erro desconhecido.'}`;
        setErrorMessage(detailedError);
        setStatusMessage("Erro no Envio");
        toast({
          title: "Erro no Envio",
          description: detailedError,
          variant: "destructive",
        });
        // Considerar parar o rastreamento em caso de erro persistente?
        // stopTracking(); // Removido daqui, parar apenas em erros de permissão ou comunicação
      }
    } catch (error) {
      // Captura erros inesperados na chamada da Server Action (ex: falha de rede do cliente para o servidor Next.js)
      console.error("Erro ao chamar Server Action:", error);
      let errMsg = 'Erro inesperado ao comunicar com o servidor da aplicação.';
      if (error instanceof Error) {
        errMsg = `Erro de comunicação: ${error.message}`;
      }
      setErrorMessage(errMsg);
      setStatusMessage("Erro na Comunicação");
      toast({
        title: "Erro de Comunicação",
        description: errMsg,
        variant: "destructive",
      });
      // Parar o rastreamento em caso de falha grave de comunicação com o servidor da app
      stopTracking();
    } finally {
      setIsSending(false); // Indica que o envio terminou (sucesso ou falha)
    }
  }, [deviceId, serverUrl, toast, stopTracking]); // Adicionado stopTracking como dependência

   // Função para obter a localização atual e iniciar o envio
   const handleTracking = useCallback(() => {
     // Previne envios múltiplos se o intervalo for muito curto ou a rede lenta
     if (isSending) {
       console.warn("Envio anterior ainda em andamento. Aguardando...");
       setStatusMessage("Aguardando envio anterior...");
       return;
     }

     // Verifica suporte a Geolocalização
     if (!('geolocation' in navigator)) {
       setErrorMessage("Geolocalização não é suportada por este navegador.");
       setIsTracking(false);
       setStatusMessage("GPS Não Suportado");
       if (intervalIdRef.current) clearInterval(intervalIdRef.current);
       intervalIdRef.current = null;
       toast({
         title: "GPS Não Suportado",
         description: "Seu navegador não suporta geolocalização.",
         variant: "destructive",
       });
       return;
     }

     // Callback de erro da Geolocalização
     const handleGeoError = (error: GeolocationPositionError) => {
       console.error("Erro ao obter localização GPS:", error);
       let errMsg = `Erro de GPS (${error.code}): ${error.message}.`;
       switch (error.code) {
         case error.PERMISSION_DENIED:
           errMsg = "Permissão de localização negada. Habilite-a nas configurações do navegador/sistema para este site.";
           // Parar rastreamento se permissão for negada permanentemente
           stopTracking();
           break;
         case error.POSITION_UNAVAILABLE:
           errMsg = "Posição GPS não disponível. Verifique se o GPS está ativado e se há sinal.";
           break;
         case error.TIMEOUT:
           errMsg = "Tempo esgotado para obter a localização GPS. Verifique o sinal.";
           break;
       }
       setErrorMessage(errMsg);
       setStatusMessage("Erro de GPS");
       // Não parar o rastreamento automaticamente em erros temporários (TIMEOUT, POSITION_UNAVAILABLE)
       toast({ title: "Erro de GPS", description: errMsg, variant: "destructive" });
     };

     // Callback de sucesso da Geolocalização
     const handleGeoSuccess = (position: GeolocationPosition) => {
       // Verifica se a precisão é aceitável (opcional, ex: menor que 500 metros)
       // if (position.coords.accuracy > 500) {
       //   setStatusMessage(`Precisão GPS baixa (${position.coords.accuracy.toFixed(0)}m). Aguardando melhor sinal...`);
       //   setErrorMessage(null);
       //   return;
       // }
       sendLocationData(position); // Envia os dados obtidos
     };

     setStatusMessage('Obtendo localização GPS...');
     setErrorMessage(null); // Limpa erro anterior ao tentar obter nova posição
     navigator.geolocation.getCurrentPosition(
       handleGeoSuccess,
       handleGeoError,
       {
         enableHighAccuracy: true, // Tenta obter a localização mais precisa possível
         maximumAge: 0, // Não usar cache de posições antigas
         timeout: 15000, // Tempo máximo para obter a posição (15 segundos)
       }
     );
   }, [sendLocationData, toast, isSending, stopTracking]); // Adicionado stopTracking como dependência

   // Função para iniciar o rastreamento
   const startTracking = useCallback(() => {
     // Validações antes de iniciar
     if (!deviceId || deviceId.trim() === '') {
       setErrorMessage("Configure o ID do Dispositivo antes de iniciar.");
       toast({ title: "Configuração Incompleta", description: "Insira um ID do Dispositivo.", variant: "destructive" });
       return;
     }
      if (!serverUrl || serverUrl.trim() === '') {
       setErrorMessage("Configure a URL do Servidor antes de iniciar.");
       toast({ title: "Configuração Incompleta", description: "Insira a URL do servidor.", variant: "destructive" });
       return;
     }
     if (isNaN(intervalSeconds) || !Number.isInteger(intervalSeconds) || intervalSeconds < 1) {
       setErrorMessage("O intervalo deve ser um número inteiro positivo (mínimo 1 segundo).");
       toast({ title: "Intervalo Inválido", description: "Insira um intervalo válido em segundos.", variant: "destructive" });
       return;
     }
     try {
       const validatedUrl = new URL(serverUrl);
       if (!['http:', 'https:'].includes(validatedUrl.protocol)) throw new Error("Protocolo inválido.");
     } catch (_) {
       setErrorMessage(`URL do Servidor inválida: ${serverUrl}. Use http:// ou https://`);
       toast({ title: "URL Inválida", description: "Insira uma URL de servidor válida.", variant: "destructive" });
       return;
     }
     if (!('geolocation' in navigator)) {
       setErrorMessage("Geolocalização não suportada. Não é possível iniciar.");
       toast({ title: "GPS Não Suportado", description: "Rastreamento não pode ser iniciado.", variant: "destructive" });
       return;
     }

     setIsTracking(true);
     setStatusMessage("Iniciando rastreamento...");
     setErrorMessage(null);

     handleTracking(); // Tenta obter e enviar a localização imediatamente

     // Limpa qualquer intervalo anterior e define um novo
     if (intervalIdRef.current) clearInterval(intervalIdRef.current);
     intervalIdRef.current = setInterval(handleTracking, intervalSeconds * 1000);

     toast({
       title: "Rastreamento Iniciado",
       description: `Enviando localização a cada ${intervalSeconds} segundos.`,
     });

   }, [deviceId, serverUrl, intervalSeconds, handleTracking, toast]);


   // Adiciona um toast ao parar manualmente
   const handleStopClick = () => {
       stopTracking();
       toast({ title: "Rastreamento Parado" });
   }


  // Handler para mudança no input de intervalo
  const handleIntervalChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const valueString = e.target.value;
    // Permite campo vazio temporariamente durante a digitação
    if (valueString === '') {
      setIntervalSeconds(NaN); // Usa NaN para indicar valor inválido temporário
      setErrorMessage("O intervalo não pode ser vazio.");
      // Não mostra toast imediatamente, apenas marca como erro
      return;
    }

    const value = parseInt(valueString, 10);

    if (!isNaN(value) && value >= 1 && Number.isInteger(value)) {
      setIntervalSeconds(value);
      setErrorMessage(null); // Limpa erro se o valor for válido
      // Se o rastreamento estiver ativo, reinicia o intervalo com o novo valor
      if (isTracking) {
        if (intervalIdRef.current) clearInterval(intervalIdRef.current);
        intervalIdRef.current = setInterval(handleTracking, value * 1000);
        toast({
          title: "Intervalo Atualizado",
          description: `Enviando localização a cada ${value} segundos.`,
        });
      }
    } else {
      setIntervalSeconds(NaN); // Marca como inválido
      const errorMsg = "Intervalo inválido. Use um número inteiro de segundos (mínimo 1).";
      setErrorMessage(errorMsg);
      // Mostra toast apenas se o valor digitado for inválido (não vazio)
      if (valueString !== '') {
        toast({ title: "Intervalo Inválido", description: errorMsg, variant: "destructive" });
      }
      // Se estava rastreando, para o intervalo para evitar problemas
      if (isTracking && intervalIdRef.current) {
        clearInterval(intervalIdRef.current);
        intervalIdRef.current = null;
        setStatusMessage("Intervalo Inválido - Rastreamento Pausado");
      }
    }
  };


  // Handler para mudança na URL do servidor
  const handleServerUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const newUrl = e.target.value;
      setServerUrl(newUrl);

      // Validação em tempo real (opcional, mas útil)
      try {
          if (newUrl.trim() !== '') {
              const validatedUrl = new URL(newUrl);
              if (!['http:', 'https:'].includes(validatedUrl.protocol)) {
                  setErrorMessage("URL inválida: Protocolo deve ser http:// ou https://");
              } else {
                  setErrorMessage(null); // Limpa erro se a URL for válida
              }
          } else {
              setErrorMessage("A URL do Servidor não pode ser vazia.");
          }
      } catch (_) {
          setErrorMessage("URL do Servidor inválida.");
      }
  };


  // Renderização do componente
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4 font-sans">
      <Card className="w-full max-w-md shadow-lg rounded-xl border">
        <CardHeader className="p-6">
          <CardTitle className="text-2xl font-bold text-center text-foreground">Cliente Web Traccar</CardTitle>
          <CardDescription className="text-center text-muted-foreground pt-1">
            Envie a localização do seu navegador para um servidor Traccar.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6 p-6">
          {/* Exibe alerta de erro, se houver */}
          {errorMessage && (
            <Alert variant="destructive" className="rounded-md">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Erro</AlertTitle>
              <AlertDescription>{errorMessage}</AlertDescription>
            </Alert>
          )}

          {/* Campo: ID do Dispositivo */}
          <div className="space-y-2">
            <Label htmlFor="deviceId" className="font-medium">Identificador do Dispositivo</Label>
            <Input
              id="deviceId"
              placeholder="Insira um ID único (ex: celular-joao)"
              value={deviceId}
              onChange={(e) => setDeviceId(e.target.value)}
              disabled={isTracking} // Desabilita se estiver rastreando
              className="bg-card rounded-md shadow-sm"
              aria-required="true"
              aria-describedby="deviceId-desc" // Adiciona descrição para acessibilidade
            />
             <p id="deviceId-desc" className="text-xs text-muted-foreground pt-1">
                Este ID será usado para identificar seu dispositivo no servidor Traccar.
             </p>
          </div>

          {/* Campo: URL do Servidor Traccar */}
          <div className="space-y-2">
            <Label htmlFor="serverUrl" className="font-medium">URL do Servidor Traccar</Label>
            <Input
              id="serverUrl"
              placeholder="Ex: http://seu.servidor.com:5055"
              value={serverUrl}
              onChange={handleServerUrlChange} // Usa handler com validação
              disabled={isTracking} // Desabilita se estiver rastreando
              type="url" // Validação básica de formato URL pelo navegador
              className={`bg-card rounded-md shadow-sm ${errorMessage?.includes('URL') ? 'border-destructive ring-destructive' : ''}`} // Highlight se erro de URL
              aria-required="true"
              aria-invalid={errorMessage?.includes('URL')} // Indica invalidade para acessibilidade
              aria-describedby="serverUrl-desc" // Adiciona descrição para acessibilidade
            />
            <p id="serverUrl-desc" className="text-xs text-muted-foreground pt-1">
              Use o protocolo OsmAnd (porta padrão 5055). A conexão é feita via servidor da aplicação. Exemplo: <code>http://demo.traccar.org:5055</code>
            </p>
          </div>

          {/* Campo: Intervalo de Rastreamento */}
          <div className="space-y-2">
            <Label htmlFor="interval" className="font-medium">Intervalo de Envio (segundos)</Label>
            <Input
              id="interval"
              type="number"
              min="1" // Mínimo 1 segundo
              step="1" // Apenas inteiros
              placeholder="Mínimo 1 segundo"
              value={isNaN(intervalSeconds) ? '' : intervalSeconds} // Mostra vazio se NaN
              onChange={handleIntervalChange}
              // Adiciona estilo de erro se o valor for inválido (NaN)
              className={`bg-card rounded-md shadow-sm ${isNaN(intervalSeconds) ? 'border-destructive ring-destructive' : ''}`}
              aria-required="true"
              aria-invalid={isNaN(intervalSeconds)} // Indica invalidade para acessibilidade
              aria-describedby="interval-desc" // Adiciona descrição para acessibilidade
            />
             <p id="interval-desc" className="text-xs text-muted-foreground pt-1">
                Frequência com que a localização será enviada (mínimo 1 segundo).
             </p>
          </div>

          {/* Botão Iniciar/Parar e Status */}
          <div className="flex flex-col items-center space-y-4 pt-2">
            <Button
              onClick={isTracking ? handleStopClick : startTracking} // Chama handleStopClick para mostrar toast ao parar
              className={`w-full text-lg py-3 rounded-md shadow-md transition-colors duration-200 ${
                isTracking
                  ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90' // Vermelho para parar
                  : 'bg-primary text-primary-foreground hover:bg-primary/90' // Azul/Primary para iniciar
              }`}
              aria-label={isTracking ? 'Parar Rastreamento' : 'Iniciar Rastreamento'}
              // Desabilita o botão Iniciar se:
              // - Já estiver enviando (isSending)
              // - Não estiver rastreando E (intervalo inválido OU ID vazio OU URL vazia ou inválida)
              disabled={isSending || (!isTracking && (
                   isNaN(intervalSeconds)
                || !deviceId || deviceId.trim() === ''
                || !serverUrl || serverUrl.trim() === ''
                || errorMessage?.includes('URL') // Desabilita se a URL é inválida
              ))}
            >
              {/* Ícone dinâmico: Spinner, Quadrado ou Play */}
              {isSending ? (
                <Loader2 className="mr-2 h-5 w-5 animate-spin" /> // Spinner durante envio
              ) : isTracking ? (
                <Square className="mr-2 h-5 w-5" /> // Ícone Parar
              ) : (
                <Play className="mr-2 h-5 w-5" /> // Ícone Iniciar
              )}
              {/* Texto dinâmico do botão */}
              {isSending ? 'Enviando...' : (isTracking ? 'Parar Rastreamento' : 'Iniciar Rastreamento')}
            </Button>

            {/* Indicador de Status */}
            <div
              role="status" // Indica que é uma região de status
              aria-live="polite" // Notifica mudanças educadamente
              className={`flex items-center space-x-2 py-2 px-4 rounded-full text-sm font-medium transition-colors duration-200 ${
                errorMessage // Vermelho se houver erro
                  ? 'bg-destructive/10 text-destructive'
                  : isTracking // Verde (accent) se rastreando e sem erro
                  ? 'bg-accent/10 text-accent'
                  : 'bg-muted text-muted-foreground' // Cinza se parado e sem erro
            }`}>
              {/* Ícone de status dinâmico */}
              { errorMessage ? <AlertCircle className="h-5 w-5"/> : (isTracking ? <Wifi className="h-5 w-5"/> : <WifiOff className="h-5 w-5"/>) }
              {/* Mensagem de status */}
              <span className="truncate max-w-xs">{statusMessage}</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default TraccarWebClient;
