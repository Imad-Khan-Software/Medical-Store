(function(){
  const supabase = window.supabaseClient || window.supabase;
  const UI = window.UI;
  const RxUtils = window.RxUtils;

  document.addEventListener('DOMContentLoaded', ()=>{
    const toggle = document.getElementById('togglePassword'); if(toggle){ toggle.addEventListener('click', function(){ const password = document.getElementById('password'); const icon = this.querySelector('i'); if(password.type === 'password'){ password.type = 'text'; icon.classList.remove('fa-eye'); icon.classList.add('fa-eye-slash'); } else { password.type = 'password'; icon.classList.remove('fa-eye-slash'); icon.classList.add('fa-eye'); } }); }

    const form = document.getElementById('login-form'); if(form){ form.addEventListener('submit', async (e)=>{
      e.preventDefault(); const btn = form.querySelector('button[type=submit]'); UI.setBtnLoading(btn, true);
      try{
        const email = document.getElementById('email').value.trim(); const password = document.getElementById('password').value;
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if(error) { UI.showToast(error.message || 'Login failed','error'); return; }
        const { data: profile, error: profileErr } = await supabase.from('profiles').select('role').eq('id', data.user.id).single();
        if(profileErr || !profile){ UI.showToast('No profile found for this account.','error'); await supabase.auth.signOut(); return; }
        UI.showToast('Login successful','success'); window.location.href = profile.role === 'admin' ? 'admin.html' : 'index.html';
      }catch(err){ UI.showToast('Login failed: '+(err.message||err),'error'); }
      finally{ UI.setBtnLoading(btn, false); }
    }); }

    // redirect if already signed in
    (async ()=>{
      try{
        const { data: { session } } = await supabase.auth.getSession(); if(session){ const { data: profile } = await supabase.from('profiles').select('role').eq('id', session.user.id).single(); if(profile) window.location.href = profile.role === 'admin' ? 'admin.html' : 'index.html'; }
      }catch(e){ /* ignore */ }
    })();
  });
})();
