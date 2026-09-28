
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait('^a'); Start-Sleep -Milliseconds 400
[System.Windows.Forms.SendKeys]::SendWait('^v'); Start-Sleep -Milliseconds 2500
[System.Windows.Forms.SendKeys]::SendWait('^s'); Start-Sleep -Milliseconds 900
Write-Output 'KEYS-SENT'
