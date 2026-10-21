import {createClient} from 'https://esm.sh/@supabase/supabase-js@2';
const c=window.CHURCH_CONFIG||{};
export const configured=Boolean(c.supabaseUrl&&c.supabaseAnonKey);
export const db=configured?createClient(c.supabaseUrl,c.supabaseAnonKey):null;
export const escapeHTML=s=>String(s??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
export const fmt=d=>new Date(d).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'});
export function occurrences(events,months=6){let out=[],end=new Date();end.setMonth(end.getMonth()+months);for(const e of events){let d=new Date(e.starts_at),n=0;while(d<=end&&n<60){if(d>=new Date(Date.now()-86400000))out.push({...e,occurs_at:d.toISOString()});if(e.recurrence==='weekly')d.setDate(d.getDate()+7);else if(e.recurrence==='monthly'){const day=d.getDate();d.setDate(1);d.setMonth(d.getMonth()+1);d.setDate(Math.min(day,new Date(d.getFullYear(),d.getMonth()+1,0).getDate()));}else break;n++}}return out.sort((a,b)=>new Date(a.occurs_at)-new Date(b.occurs_at));}
export async function readPublic(){if(!db)return {events:[],announcements:[]};const mine=q=>c.churchId?q.eq('church_id',c.churchId):q;const [ev,an]=await Promise.all([mine(db.from('church_events').select('*').eq('published',true)).order('starts_at'),mine(db.from('church_announcements').select('*').eq('published',true)).order('created_at',{ascending:false})]);if(ev.error)throw ev.error;if(an.error)throw an.error;return {events:ev.data,announcements:an.data};}
