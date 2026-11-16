// The DOM HUD: health, ammo, timer, score, money, killfeed, buy menu, plant
// progress and the overlay panels. It never touches the simulation; main.js
// pushes numbers in and reads callbacks out. Every setter skips a DOM write
// when the value did not change.
const COPY = {
  start: {
    title: 'EMBERLINE',
    copy: 'A dusk freight yard, one bombsite, four defenders. Plant the charge on the Kestrel Pad or clear the yard. Click to play.',
    action: 'Click to play',
  },
  paused: {
    title: 'EMBERLINE',
    copy: 'Paused. Click to resume.',
    action: 'Click to resume',
  },
};

export function createHud() {
  const overlay = document.getElementById('overlay');
  const title = document.getElementById('overlay-title');
  const copy = document.getElementById('overlay-copy');
  const play = document.getElementById('play');
  const ammoMag = document.getElementById('ammo-mag');
  const ammoReserve = document.getElementById('ammo-reserve');
  const ammo = document.getElementById('ammo');
  const weaponName = document.getElementById('weapon-name');
  const healthFill = document.getElementById('health-fill');
  const healthValue = document.getElementById('health-value');
  const moneyValue = document.getElementById('money-value');
  const timerValue = document.getElementById('timer-value');
  const scoreValue = document.getElementById('score-value');
  const roundValue = document.getElementById('round-value');
  const hitmarker = document.getElementById('hitmarker');
  const killfeed = document.getElementById('killfeed');
  const banner = document.getElementById('banner');
  const bannerTitle = document.getElementById('banner-title');
  const bannerSub = document.getElementById('banner-sub');
  const plant = document.getElementById('plant');
  const plantFill = document.getElementById('plant-fill');
  const damage = document.getElementById('damage');
  const buyMenu = document.getElementById('buymenu');
  const buyItems = document.getElementById('buy-items');
  const buyMoney = document.getElementById('buy-money');
  let hitTimer = 0;
  let bannerTimer = 0;
  let last = { mag: -1, reserve: -1, hp: -1, money: -1, timer: '', score: '', round: -1, weapon: '' };
  let buyHandler = null;

  function setText(element, value, key) {
    if (last[key] === value) return;
    last[key] = value;
    element.textContent = value;
  }

  return {
    setAmmo(mag, reserve) {
      setText(ammoMag, String(mag), 'mag');
      setText(ammoReserve, `/ ${reserve}`, 'reserve');
      ammo.classList.toggle('empty', mag === 0);
    },
    setWeapon(name) {
      setText(weaponName, name, 'weapon');
    },
    setHealth(hp) {
      if (last.hp === hp) return;
      last.hp = hp;
      healthFill.style.width = `${hp}%`;
      healthValue.textContent = String(hp);
      healthFill.classList.toggle('low', hp <= 30);
    },
    setMoney(value) {
      setText(moneyValue, `$${value}`, 'money');
      if (buyMenu && !buyMenu.hidden) buyMoney.textContent = `$${value}`;
    },
    setTimer(seconds, phase) {
      const text = phase === 'buy' ? `BUY ${Math.ceil(seconds)}` : `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
      setText(timerValue, text, 'timer');
      timerValue.classList.toggle('buy', phase === 'buy');
      timerValue.classList.toggle('urgent', phase !== 'buy' && seconds <= 15);
    },
    setScore(wins, losses, round) {
      setText(scoreValue, `${wins} — ${losses}`, 'score');
      setText(roundValue, `ROUND ${round}`, 'round');
    },
    hitMarker(killed, holdMs = 90) {
      hitmarker.classList.add('on');
      hitmarker.classList.toggle('kill', killed);
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => hitmarker.classList.remove('on', 'kill'), holdMs);
    },
    damageFlash() {
      damage.classList.add('on');
      setTimeout(() => damage.classList.remove('on'), 180);
    },
    killfeed(text, good) {
      const line = document.createElement('div');
      line.className = good ? 'feed-line good' : 'feed-line';
      line.textContent = text;
      killfeed.prepend(line);
      while (killfeed.children.length > 4) killfeed.lastChild.remove();
      setTimeout(() => line.remove(), 6000);
    },
    showBanner(titleText, subText, ms = 2600) {
      bannerTitle.textContent = titleText;
      bannerSub.textContent = subText;
      banner.hidden = false;
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => {
        banner.hidden = true;
      }, ms);
    },
    hideBanner() {
      banner.hidden = true;
      clearTimeout(bannerTimer);
    },
    setPlant(progress, visible) {
      plant.hidden = !visible;
      if (visible) plantFill.style.width = `${Math.round(progress * 100)}%`;
    },
    showOverlay(mode, data = {}) {
      if (mode === 'roundEnd' || mode === 'matchEnd') {
        title.textContent = data.won ? 'ROUND WON' : 'ROUND LOST';
        if (mode === 'matchEnd') title.textContent = data.won ? 'YARD TAKEN — YOU WIN' : 'YARD HELD — YOU LOSE';
        copy.textContent = `${data.reason} Score ${data.wins} — ${data.losses}.`;
        play.textContent = mode === 'matchEnd' ? 'Play again' : 'Next round';
      } else {
        const text = COPY[mode];
        title.textContent = text.title;
        copy.textContent = text.copy;
        play.textContent = text.action;
      }
      overlay.hidden = false;
      play.focus();
    },
    hideOverlay() {
      overlay.hidden = true;
    },
    onPlay(handler) {
      play.addEventListener('click', handler);
    },
    // Buy menu: main.js passes the catalogue with owned flags; clicks go back
    // through the handler, which returns the new money or null when it fails.
    showBuy(items, money) {
      buyMoney.textContent = `$${money}`;
      buyItems.innerHTML = '';
      for (const item of items) {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'buy-row';
        row.disabled = item.owned || money < item.price;
        row.innerHTML = `<span class="buy-key">${item.key}</span><span class="buy-name">${item.name}<span class="buy-desc">${item.desc}</span></span><span class="buy-price">${item.owned ? 'OWNED' : '$' + item.price}</span>`;
        row.addEventListener('click', () => {
          if (buyHandler) buyHandler(item.id);
        });
        buyItems.appendChild(row);
      }
      buyMenu.hidden = false;
    },
    hideBuy() {
      buyMenu.hidden = true;
    },
    buyOpen() {
      return !buyMenu.hidden;
    },
    onBuy(handler) {
      buyHandler = handler;
    },
  };
}
