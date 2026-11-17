$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$synth = $null
$stream = $null
try {
    $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
    if ($request.text -isnot [string] -or $request.text.Length -lt 1 -or $request.text.Length -gt 5000) { throw 'Invalid speech text length' }
    Add-Type -AssemblyName System.Speech
    $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
    $voices = @($synth.GetInstalledVoices() | Where-Object { $_.Enabled })
    if ($voices.Count -eq 0) { throw 'No installed Windows speech voices' }
    $voice = $voices | Where-Object { $_.VoiceInfo.Culture.Name -eq 'en-US' } | Select-Object -First 1
    if ($null -eq $voice) { $voice = $voices | Where-Object { $_.VoiceInfo.Culture.TwoLetterISOLanguageName -eq 'en' } | Select-Object -First 1 }
    if ($null -eq $voice) { $voice = $voices | Select-Object -First 1 }
    $synth.SelectVoice($voice.VoiceInfo.Name)
    $synth.Volume = 100
    $synth.Rate = 0
    $stream = New-Object System.IO.MemoryStream
    $synth.SetOutputToWaveStream($stream)
    # stdin JSON is data; it is never interpolated into PowerShell or SSML.
    $synth.Speak($request.text)
    $synth.SetOutputToNull()
    @{ audio = [Convert]::ToBase64String($stream.ToArray()); voice = $voice.VoiceInfo.Name; english = ($voice.VoiceInfo.Culture.TwoLetterISOLanguageName -eq 'en') } | ConvertTo-Json -Compress
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
} finally {
    if ($null -ne $synth) { $synth.Dispose() }
    if ($null -ne $stream) { $stream.Dispose() }
}
