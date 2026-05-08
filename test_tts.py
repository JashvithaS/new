import asyncio
import edge_tts

VOICES = {
    "fr": "fr-FR-DeniseNeural",
    "es": "es-ES-ElviraNeural",
    "de": "de-DE-KatjaNeural",
    "ja": "ja-JP-NanamiNeural",
    "pt": "pt-PT-RaquelNeural"
}

TEST_SENTENCES = {
    "fr": "Bonjour! Je suis Aria, votre tuteur de langue.",
    "es": "Hola! Soy Aria, tu tutora de idiomas.",
    "de": "Hallo! Ich bin Aria, deine Sprachlehrerin.",
    "ja": "Konnichiwa! Watashi wa Aria desu.",
    "pt": "Ola! Sou Aria, sua tutora de idiomas."
}

async def test_voice(lang):
    voice = VOICES[lang]
    text  = TEST_SENTENCES[lang]
    print(f"Testing {lang} - {voice}")
    tts = edge_tts.Communicate(text, voice)
    await tts.save(f"test_{lang}.mp3")
    print(f"Saved test_{lang}.mp3")

async def main():
    for lang in VOICES:
        await test_voice(lang)
    print("All done! Check your Downloads folder for mp3 files")

asyncio.run(main())
