CREATE OR REPLACE FUNCTION public.handle_new_message_push()
RETURNS TRIGGER AS $$
DECLARE
  v_supabase_url TEXT := 'https://lbppjcyzgrkhtygbporq.supabase.co';
  v_sender_name TEXT := 'Someone';
  v_recipient_id UUID;
  v_body TEXT;
BEGIN
  -- Look up the other participant in this conversation
  SELECT
    CASE 
      WHEN participant_a = NEW.sender_id THEN participant_b
      ELSE participant_a
    END
  INTO v_recipient_id
  FROM public.conversations
  WHERE id = NEW.conversation_id;

  -- Fallback if not found
  IF v_recipient_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Get sender name
  SELECT COALESCE(name, 'Someone') INTO v_sender_name
  FROM public.profiles
  WHERE id = NEW.sender_id;

  -- Format message preview
  IF NEW.voice_url IS NOT NULL THEN
    v_body := v_sender_name || ' sent a voice note 🎙️';
  ELSIF NEW.media_url IS NOT NULL THEN
    v_body := v_sender_name || ' sent an image 📷';
  ELSE
    v_body := v_sender_name || ': ' || COALESCE(NULLIF(NEW.body, ''), 'sent a message');
  END IF;

  -- Dispatch via pg_net async HTTP request
  PERFORM net.http_post(
    url := v_supabase_url || '/functions/v1/send-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object(
      'recipientId', v_recipient_id,
      'title', 'New message',
      'body', v_body,
      'url', '/messages/' || NEW.conversation_id::text
    )
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger on messages table
DROP TRIGGER IF EXISTS on_message_created_push ON public.messages;
CREATE TRIGGER on_message_created_push
AFTER INSERT ON public.messages
FOR EACH ROW
EXECUTE FUNCTION public.handle_new_message_push();