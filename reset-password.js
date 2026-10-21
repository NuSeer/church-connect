import {db} from './data.js';
const $=id=>document.getElementById(id);
const status=(t,bad)=>{$('status').textContent=t;$('status').style.color=bad?'#b91c1c':''};
function showForm(){$('resetForm').classList.remove('hidden');status('Choose a new password.')}
async function init(){
 if(!db)return status('Sign-in is not configured on this site.',true);
 db.auth.onAuthStateChange(event=>{if(event==='PASSWORD_RECOVERY')showForm()});
 // The emailed link signs the member in briefly; give the client a moment to read it from the address.
 await new Promise(r=>setTimeout(r,800));
 const {data:{session}}=await db.auth.getSession();
 if(session)showForm();else status('This reset link is missing or has expired. Go back to sign in and tap "Forgot password?" for a new one.',true);
}
$('resetForm').onsubmit=async ev=>{
 ev.preventDefault();const a=$('newPassword').value,b=$('confirmNewPassword').value;
 if(a.length<8)return status('Use a password of at least 8 characters.',true);
 if(a!==b)return status('The two passwords do not match.',true);
 const {error}=await db.auth.updateUser({password:a});
 $('newPassword').value='';$('confirmNewPassword').value='';
 if(error)return status(error.message,true);
 await db.auth.signOut();$('resetForm').classList.add('hidden');$('done').classList.remove('hidden');status('Your password was changed.');
};
init();
