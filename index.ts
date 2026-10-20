// Supabase Edge Function: database webhook on INSERT into public.messages.
// Configure VERIFY_JWT=false for this webhook endpoint; authenticate with x-cc-webhook-secret.
import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';
const url=Deno.env.get('SUPABASE_URL')!;
const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const secret=Deno.env.get('CC_PUSH_WEBHOOK_SECRET')!;
webpush.setVapidDetails('mailto:'+Deno.env.get('CC_VAPID_CONTACT_EMAIL')!,Deno.env.get('CC_VAPID_PUBLIC_KEY')!,Deno.env.get('CC_VAPID_PRIVATE_KEY')!);
const db=createClient(url,key,{auth:{persistSession:false}});
Deno.serve(async request=>{
 if(request.method!=='POST')return new Response('Method not allowed',{status:405});
 if(!secret||request.headers.get('x-cc-webhook-secret')!==secret)return new Response('Unauthorized',{status:401});
 try{
  const event=await request.json();const m=event.record;
  if(event.type!=='INSERT'||event.table!=='messages'||!m?.id||!m?.conversation_id||!m?.sender_id)return new Response('Ignored',{status:200});
  const {data:conversation,error:ce}=await db.from('conversations').select('id,kind,ministry_id').eq('id',m.conversation_id).single();if(ce||!conversation)throw ce||Error('Conversation missing');
  const {data:direct,error:de}=await db.from('conversation_members').select('user_id').eq('conversation_id',m.conversation_id);if(de)throw de;
  const ids=new Set((direct||[]).map((x:any)=>x.user_id));
  if(conversation.kind==='ministry'&&conversation.ministry_id){const {data:members,error:me}=await db.from('ministry_members').select('user_id').eq('ministry_id',conversation.ministry_id);if(me)throw me;for(const member of members||[])ids.add(member.user_id)}
  ids.delete(m.sender_id);if(!ids.size)return new Response('No recipients',{status:200});
  const {data:approved,error:ae}=await db.from('member_profiles').select('user_id').in('user_id',[...ids]).eq('approved',true);if(ae)throw ae;
  const recipients=(approved||[]).map((x:any)=>x.user_id);if(!recipients.length)return new Response('No approved recipients',{status:200});
  const {data:subs,error:se}=await db.from('member_push_subscriptions').select('id,endpoint,p256dh,auth').in('user_id',recipients);if(se)throw se;
  const payload=JSON.stringify({title:conversation.kind==='ministry'?'New ministry message':'New private message',body:'You have a new message in Church Connect.',conversationId:m.conversation_id,messageId:m.id});
  const results=await Promise.allSettled((subs||[]).map(async (s:any)=>{try{await webpush.sendNotification({endpoint:s.endpoint,keys:{p256dh:s.p256dh,auth:s.auth}},payload,{TTL:86400})}catch(err:any){if(err.statusCode===404||err.statusCode===410)await db.from('member_push_subscriptions').delete().eq('id',s.id);throw err}}));
  return Response.json({attempted:results.length,accepted:results.filter(r=>r.status==='fulfilled').length,failed:results.filter(r=>r.status==='rejected').length});
 }catch(err){console.error(err);return new Response('Push dispatch error',{status:500})}
});
