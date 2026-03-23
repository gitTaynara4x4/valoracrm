import smtplib
import os
from email.message import EmailMessage

# Puxa os dados do seu .env
EMAIL_REMETENTE = os.getenv("EMAIL_REMETENTE")
EMAIL_SENHA = os.getenv("EMAIL_SENHA")

def enviar_codigo_por_email(email_cliente: str, codigo: str):
    # 1. Monta a estrutura do e-mail
    msg = EmailMessage()
    msg['Subject'] = 'Confirmação de Cadastro - Valora CRM'
    msg['From'] = EMAIL_REMETENTE
    msg['To'] = email_cliente
    
    # 2. Escreve o corpo do e-mail
    msg.set_content(f"""\
Olá!

Você iniciou o cadastro no Valora CRM.
Seu código de confirmação de 6 dígitos é: 

{codigo}

Se não foi você, por favor ignore esta mensagem.
""")

    # 3. Faz o login no Gmail e dispara a mensagem
    try:
        # Usa o servidor SMTP do Gmail na porta segura (465)
        with smtplib.SMTP_SSL('smtp.gmail.com', 465) as smtp:
            smtp.login(EMAIL_REMETENTE, EMAIL_SENHA)
            smtp.send_message(msg)
            print(f"[INFO] E-mail enviado com sucesso para {email_cliente}")
    except Exception as e:
        print(f"[ERRO] Falha ao enviar e-mail: {e}")