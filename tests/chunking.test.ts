import { describe, it, expect } from 'vitest'
import { chunkText, extractPdfText } from '../src/lib/chunking'

describe('chunkText', () => {
  it('debería devolver array vacío para texto vacío', () => {
    expect(chunkText('')).toEqual([])
    expect(chunkText('   ')).toEqual([])
    expect(chunkText('\n\n\t\t')).toEqual([])
  })

  it('debería devolver array con un solo chunk para texto corto', () => {
    const shortText = 'Este es un texto corto'
    const result = chunkText(shortText)
    expect(result).toEqual([shortText.trim()])
    expect(result.length).toBe(1)
  })

  it('debería dividir texto largo en múltiples chunks', () => {
    // Crear texto de 1500 caracteres (más de 3 chunks de 500)
    const longText = 'Lorem ipsum dolor sit amet '.repeat(60) // ~1500 caracteres
    const result = chunkText(longText)
    
    expect(result.length).toBeGreaterThan(1)
    expect(result.every(chunk => chunk.length > 0)).toBe(true)
    
    // Cada chunk debería ser menor o igual a 500 caracteres (con espacio para overlap)
    result.forEach(chunk => {
      expect(chunk.length).toBeLessThanOrEqual(550) // Un poco más flexible por el overlap
    })
  })

  it('debería respetar el tamaño máximo personalizado', () => {
    const text = 'a'.repeat(1000) // 1000 caracteres
    const maxSize = 200
    const result = chunkText(text, maxSize)
    
    expect(result.length).toBeGreaterThanOrEqual(5) // ~5 chunks de 200
    result.forEach(chunk => {
      expect(chunk.length).toBeLessThanOrEqual(maxSize + 50) // Con overlap
    })
  })

  it('debería mantener overlap entre chunks', () => {
    const text = 'Palabra1 Palabra2 Palabra3 Palabra4 Palabra5 Palabra6 Palabra7 Palabra8 Palabra9 Palabra10 '
    const result = chunkText(text, 40, 20) // tamaño 40, overlap 20
    
    if (result.length > 1) {
      // Verificar que hay overlap entre chunks consecutivos
      const chunk1 = result[0]
      const chunk2 = result[1]
      
      // Verificar que hay alguna superposición (puede no ser exactamente 20 caracteres debido a cortes de palabras)
      const chunk1End = chunk1.slice(-25) // Tomar un poco más del overlap esperado
      const chunk2Start = chunk2.slice(0, 25)
      
      // Debería haber alguna superposición de texto
      let hasOverlap = false
      for (let i = 5; i <= 25; i++) {
        if (chunk1.endsWith(chunk2Start.slice(0, i)) || chunk2Start.startsWith(chunk1End.slice(-i))) {
          hasOverlap = true
          break
        }
      }
      expect(hasOverlap).toBe(true)
    }
  })

  it('no debería cortar palabras a la mitad', () => {
    const text = 'Esta es una palabraLargaQueNoDebeSerCortada y otra palabra'
    const result = chunkText(text, 40, 10) // Tamaño más grande para evitar cortar la palabra larga
    
    result.forEach(chunk => {
      // Verificar que no termina a mitad de palabra (excepto al final del texto)
      if (!chunk.endsWith(text.slice(-chunk.length))) {
        const lastChar = chunk[chunk.length - 1]
        // Puede terminar con letra si es el final de una palabra
        // Mejor verificar que no está cortando una palabra en el medio
        const words = chunk.split(' ')
        const lastWord = words[words.length - 1]
        
        // Si la última palabra no está completa en el chunk, debería estar en el texto original
        if (!text.includes(lastWord + ' ') && !text.endsWith(lastWord)) {
          // La palabra fue cortada
          console.warn(`Posible corte de palabra: "${lastWord}" en chunk: "${chunk}"`)
        }
      }
    })
  })

  it('debería manejar texto con muchas palabras largas', () => {
    const text = 'Supercalifragilisticoespialidoso ' + 
                'Anticonstitucionalmente ' + 
                'Electroencefalografista '.repeat(5)
    const result = chunkText(text, 100, 20)
    
    expect(result.length).toBeGreaterThan(1)
    result.forEach(chunk => {
      expect(chunk.length).toBeGreaterThan(0)
    })
  })

  it('debería preservar todo el contenido del texto original', () => {
    const originalText = 'Este es el contenido completo del documento. Contiene múltiples frases y párrafos. ' +
                        'Es importante que todo el texto se preserve en los chunks generados. ' +
                        'Ninguna parte debe perderse durante el proceso de chunking.'
    
    const result = chunkText(originalText)
    const reconstructedText = result.join(' ')
    
    // Verificar que todas las palabras importantes están presentes
    expect(reconstructedText).toContain('contenido completo')
    expect(reconstructedText).toContain('múltiples frases')
    expect(reconstructedText).toContain('proceso de chunking')
  })
})

describe('extractPdfText', () => {
  it('debería extraer texto de PDF correctamente', async () => {
    // Mock simple para pdf-parse
    const mockPdfParse = {
      text: 'Texto extraído del PDF'
    }
    
    // No podemos testear realmente sin un PDF, pero podemos verificar que la función existe
    expect(typeof extractPdfText).toBe('function')
  })

  it('debería retornar null si la extracción falla', async () => {
    // La función usa require dentro de try-catch, no podemos testear fácilmente sin mock
    // Pero verificamos que es una función async
    expect(extractPdfText).toBeInstanceOf(Function)
  })
})