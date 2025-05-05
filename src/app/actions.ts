
'use server';

import { z } from 'zod';

// Define the schema for the input data
const TraccarDataSchema = z.object({
  serverUrl: z.string().url({ message: "URL do Servidor inválida." }),
  deviceId: z.string().min(1, { message: "ID do Dispositivo é obrigatório." }),
  lat: z.number(),
  lon: z.number(),
  timestamp: z.number(),
  accuracy: z.number().optional(),
  altitude: z.number().optional(),
  speed: z.number().optional(),
  bearing: z.number().optional(), // Changed from 'heading' to 'bearing' as per Traccar OsmAnd protocol
});

export type SendTraccarDataInput = z.infer<typeof TraccarDataSchema>;

/**
 * Sends location data to the specified Traccar server using the OsmAnd protocol.
 * This function runs on the server, bypassing browser CORS and mixed-content issues.
 * @param input - The location data and server configuration.
 * @returns An object indicating success or failure with an optional error message.
 */
export async function sendTraccarData(input: SendTraccarDataInput): Promise<{ success: boolean; message?: string }> {
  const validation = TraccarDataSchema.safeParse(input);

  if (!validation.success) {
    // Combine validation errors into a single message
    const errorMessages = validation.error.errors.map((e) => e.message).join(', ');
    console.error('Server Action Validation Error:', errorMessages);
    return { success: false, message: `Dados inválidos: ${errorMessages}` };
  }

  const { serverUrl, deviceId, lat, lon, timestamp, accuracy, altitude, speed, bearing } = validation.data;

  // Construct URL and parameters
  let validatedUrl: URL;
  try {
    validatedUrl = new URL(serverUrl);
    if (!['http:', 'https:'].includes(validatedUrl.protocol)) {
        throw new Error("Protocolo inválido. Use http ou https.");
    }
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : "URL inválida";
    console.error('Server Action URL Parse Error:', errMsg);
    return { success: false, message: `URL do Servidor inválida: ${serverUrl}. ${errMsg}` };
  }

  const params = new URLSearchParams({
    id: deviceId,
    lat: lat.toString(),
    lon: lon.toString(),
    timestamp: timestamp.toString(),
  });

  if (accuracy !== undefined) params.append('accuracy', accuracy.toString());
  if (altitude !== undefined) params.append('altitude', altitude.toString());
  if (speed !== undefined && speed >= 0) params.append('speed', speed.toString());
  if (bearing !== undefined && bearing >= 0) params.append('bearing', bearing.toString());

  // Construct the final URL for the POST request
  // Some servers might expect query params in the URL even for POST
  const urlWithParams = `${validatedUrl.origin}/?${params.toString()}`;
  // Alternatively, some servers might expect an empty path if the port is specified correctly
  // const urlWithParams = `${validatedUrl.origin}${validatedUrl.pathname === '/' ? '' : validatedUrl.pathname}?${params.toString()}`;

  console.log(`Server Action: Sending POST to ${urlWithParams}`);

  try {
    // Server-side fetch doesn't have CORS issues
    const response = await fetch(urlWithParams, {
      method: 'POST',
      // Headers might not be needed, but setting Content-Length to 0 is sometimes required for POST without body
      headers: {
          'Content-Length': '0'
      },
      // Increase timeout to 20 seconds
      signal: AbortSignal.timeout(20000),
    });

    console.log(`Server Action: Response Status: ${response.status}`);

    if (response.ok) {
      // Traccar OsmAnd protocol usually returns 200 OK with an empty body on success
      return { success: true, message: 'Localização enviada com sucesso (servidor).' };
    } else {
      const statusText = response.statusText || `Código ${response.status}`;
      const responseBody = await response.text().catch(() => 'Não foi possível ler o corpo da resposta.'); // Attempt to get more details
      console.error(`Server Action Error: ${statusText}`, responseBody);
      return { success: false, message: `Falha no servidor Traccar: ${statusText}. Detalhes: ${responseBody.substring(0, 100)}` };
    }
  } catch (error) {
    console.error("Server Action Fetch Error:", error);
    let errMsg = 'Erro desconhecido no servidor ao enviar dados.';
     if (error instanceof Error) {
        // Use error.name for AbortError check
        if (error.name === 'AbortError' || error.message.includes('timed out')) {
            errMsg = `Tempo esgotado ao conectar ao servidor Traccar (${validatedUrl.origin}). Verifique se está online, acessível e se o tempo limite (20s) é suficiente.`;
        } else if (error.message.includes('ECONNREFUSED')) {
            errMsg = `Conexão recusada pelo servidor Traccar (${validatedUrl.origin}). Verifique se está online e a porta está correta.`;
        } else if (error.message.includes('ENOTFOUND') || error.message.includes('EAI_AGAIN')) {
            errMsg = `Não foi possível encontrar o servidor Traccar (${validatedUrl.origin}). Verifique a URL.`;
        }
         else {
            errMsg = `Erro de rede no servidor: ${error.message}`;
        }
    }
    return { success: false, message: errMsg };
  }
}
