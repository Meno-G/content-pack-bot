// Telegram ხმოვანს `.oga` გაფართოებით ინახავს — gpt-4o-transcribe ამ გაფართოებას არ იღებს,
// თუმცა ფორმატი იგივე ogg/opus-ია. ვარქმევთ `.ogg`-ს; სხვა ფაილებს ვტოვებთ უცვლელად.
const item = $input.first();
const bin = item.binary?.data;
if (!bin) throw new Error('ფაილი ვერ ჩამოიტვირთა (binary data არ არის)');

if (/\.oga$/i.test(bin.fileName || '') || bin.fileExtension === 'oga') {
  bin.fileName = (bin.fileName || 'voice.oga').replace(/\.oga$/i, '.ogg');
  bin.fileExtension = 'ogg';
  bin.mimeType = 'audio/ogg';
}
return [item];
