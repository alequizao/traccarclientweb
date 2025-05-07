import { NextResponse, type NextRequest } from 'next/server';
import { sendTraccarData, type SendTraccarDataInput } from '@/app/actions';
import { z } from 'zod';

// Re-define or import the Zod schema for validation within the API route
const TraccarDataSchemaForApi = z.object({
  serverUrl: z.string().url({ message: "URL do Servidor inválida." }),
  deviceId: z.string().min(1, { message: "ID do Dispositivo é obrigatório." }),
  lat: z.number(),
  lon: z.number(),
  timestamp: z.number(),
  accuracy: z.number().optional(),
  altitude: z.number().optional(),
  speed: z.number().optional(), // m/s
  bearing: z.number().optional(), // heading
});


export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    const validation = TraccarDataSchemaForApi.safeParse(body);

    if (!validation.success) {
      const errorMessages = validation.error.errors.map((e) => e.message).join(', ');
      console.error('[API /api/log-traccar] Erro de Validação:', errorMessages);
      return NextResponse.json({ success: false, message: `Dados de entrada inválidos para API: ${errorMessages}` }, { status: 400 });
    }

    // Now call the server action with the validated data
    const result = await sendTraccarData(validation.data as SendTraccarDataInput);

    // The sendTraccarData action already returns { success: boolean, message?: string }
    // And handles Traccar server responses. We can pass its result through.
    if (result.success) {
      return NextResponse.json(result, { status: 200 });
    } else {
      // Determine appropriate status code based on the action's error message
      let statusCode = 500; // Default server error
      if (result.message) {
        if (result.message.includes("inválid") || result.message.includes("obrigatório")) statusCode = 400; // Bad request from original validation
        else if (result.message.includes("Traccar") && result.message.match(/código \d{3}|falha no servidor Traccar/i)) {
             // Try to extract status from Traccar's response if action included it
             const match = result.message.match(/código (\d{3})/i);
             if (match && match[1]) {
                 const traccarStatus = parseInt(match[1]);
                 if (traccarStatus >= 400 && traccarStatus < 500) statusCode = 400; // Client error to Traccar
                 else if (traccarStatus >= 500) statusCode = 502; // Bad gateway, Traccar itself errored
             } else if (result.message.toLowerCase().includes('tempo esgotado')) {
                 statusCode = 504; // Gateway timeout
             }
        }
      }
      return NextResponse.json(result, { status: statusCode });
    }
  } catch (error) {
    let errorMessage = 'Erro desconhecido no servidor API.';
    if (error instanceof SyntaxError) { // JSON parsing error
        errorMessage = "Corpo da requisição JSON inválido.";
        return NextResponse.json({ success: false, message: errorMessage }, { status: 400 });
    }
    if (error instanceof Error) {
      errorMessage = error.message;
    }
    console.error('[API /api/log-traccar] Erro Interno:', error);
    return NextResponse.json({ success: false, message: `Erro interno na API: ${errorMessage}` }, { status: 500 });
  }
}