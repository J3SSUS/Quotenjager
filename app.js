function qjTab(name){
  document.querySelectorAll('.bet-tab').forEach(function(b){
    b.classList.toggle('active', b.getAttribute('data-tab') === name);
  });
  document.querySelectorAll('.bet-panel').forEach(function(p){
    p.hidden = (p.getAttribute('data-panel') !== name);
  });
}
function route(){
  var path = location.hash.replace(/^#/, '') || '/';
  document.querySelectorAll('.page').forEach(function(p){
    p.hidden = (p.id !== 'route-' + path);
  });
  document.querySelectorAll('nav a[data-route]').forEach(function(a){
    a.classList.toggle('active', a.getAttribute('data-route') === path);
  });
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);
route();
