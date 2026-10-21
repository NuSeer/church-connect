// Shared sign-in helpers: a Show/Hide button on every password field and a "Forgot password?" link on sign-in forms.
import {db} from './data.js';
import {loadBrand} from './brand.js';

function addReveal(input){
 if(input.closest('.password-wrap'))return; // already has its own toggle
 const wrap=document.createElement('div');wrap.className='password-wrap';
 input.before(wrap);wrap.append(input);
 const b=document.createElement('button');b.type='button';b.className='password-toggle';b.textContent='Show';b.setAttribute('aria-label','Show password');b.setAttribute('aria-pressed','false');
 b.onclick=()=>{const hidden=input.type==='password';input.type=hidden?'text':'password';b.textContent=hidden?'Hide':'Show';b.setAttribute('aria-label',(hidden?'Hide':'Show')+' password');b.setAttribute('aria-pressed',String(hidden))};
 wrap.append(b);
}

function addForgot(form){
 const email=form.querySelector('input[type="email"]');
 if(!email||form.dataset.forgot)return;form.dataset.forgot='1';
 const p=document.createElement('p');p.className='small';
 const a=document.createElement('a');a.href='#';a.textContent='Forgot password?';
 const msg=document.createElement('span');msg.className='muted';msg.setAttribute('aria-live','polite');msg.style.marginLeft='10px';
 let wait=false;
 a.onclick=async ev=>{
  ev.preventDefault();if(wait)return;
  const address=email.value.trim();
  if(!address){msg.textContent='Type your email in the box above first, then tap "Forgot password?".';email.focus();return}
  if(!db){msg.textContent='Sign-in is not configured on this site.';return}
  wait=true;setTimeout(()=>{wait=false},30000);
  const {error}=await db.auth.resetPasswordForEmail(address,{redirectTo:new URL('reset-password.html',location.href).href});
  // Same wording whether or not an account exists, so the form cannot be used to discover who is a member.
  msg.textContent=error&&/rate|limit|too many/i.test(error.message)?'Please wait a minute before asking again.':'If that email has an account, a reset link is on its way. Check your inbox and spam folder.';
 };
 p.append(a,msg);form.after(p);
}

loadBrand();
document.querySelectorAll('input[type="password"]').forEach(addReveal);
document.querySelectorAll('form').forEach(f=>{if(f.querySelector('input[type="password"]'))addForgot(f)});
