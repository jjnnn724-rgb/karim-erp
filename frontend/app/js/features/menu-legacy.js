/**
 * menu-legacy.js — منطق شاشة البوفيه القديمة (نُقل من داخل menu.html)
 * ────────────────────────────────────────────────────────────────────────────
 * السبب: سكربتات inline داخل HTML محجوبة بسياسة CSP (وجود nonce يجعل
 * المتصفح يتجاهل unsafe-inline) ⇒ كانت هذه الشيفرة لا تُنفَّذ إطلاقًا.
 * ملاحظة: الصفحة نفسها legacy — /app/menu.html صار يوجّه إلى menu-board.html.
 */
    // DEFAULT LUXURY BUFFET DATA
    const DEFAULT_DATA = {
      restaurant: {
        nameAr: "مطاعم الشرفة العالمي",
        nameEn: "AL-SHURFA ROYAL OPEN BUFFET",
        ticker: "أهلاً بكم في بوفيه الشرفة العالمي • السعر شامل البوفيه المفتوح الكامل والحلويات والمشروبات والضريبة • خدمة وضيافة ملكية فاخرة",
        buffetPrice: 149,
        showPriceBadge: true
      },
      currentMeal: "lunch",
      currentDay: { en: "SUNDAY", ar: "الأحد" },
      autoRotate: false,
      rotationIntervalSec: 25,
      categories: [
        {
          id: "soups",
          nameEn: "SOUPS & APPETIZERS",
          nameAr: "الشوربة والمقبلات الساخنة",
          theme: "gold",
          icon: `<path d="M19 7H5c-1.1 0-2 .9-2 2v2c0 3.86 3.14 7 7 7h4c3.86 0 7-3.14 7-7V9c0-1.1-.9-2-2-2zm-1 4c0 2.76-2.24 5-5 5h-2c-2.76 0-5-2.24-5-5V9h12v2zm3-4H3V5h18v2zM9 3h6v2H9V3z"/>`,
          items: [
            { id: "s1", nameEn: "LENTIL SOUP WITH CUMIN", nameAr: "شوربة عدس بالكمون والليمون", meal: ["breakfast", "lunch", "dinner"], available: true },
            { id: "s2", nameEn: "ORZO CHICKEN SOUP", nameAr: "شوربة لسان عصفور بالدجاج", meal: ["lunch", "dinner"], available: true },
            { id: "s3", nameEn: "CRISPY SAMBUSA SELECTION", nameAr: "سمبوسك لحم وجبن مقرمشة", meal: ["breakfast", "lunch", "dinner"], available: true }
          ]
        },
        {
          id: "carving",
          nameEn: "CARVING & CHEF'S STATION",
          nameAr: "محطة الكارڤينج والشواء الفاخر",
          theme: "gold",
          icon: `<path d="M19.5 3c-.28 0-.53.11-.71.29l-3.08 3.09-1.42-1.42c-.39-.39-1.02-.39-1.41 0l-2.12 2.12c-.39.39-.39 1.02 0 1.41l1.41 1.42L3.29 18.79c-.39.39-.39 1.02 0 1.41l1.51 1.51c.39.39 1.02.39 1.41 0l9.88-9.88 1.42 1.41c.39.39 1.02.39 1.41 0l2.12-2.12c.39-.39.39-1.02 0-1.41l-1.41-1.42 3.09-3.08c.38-.38.38-1.02 0-1.41L20.21 3.3c-.18-.19-.43-.3-.71-.3z"/>`,
          items: [
            { id: "c1", nameEn: "PRIME MEAT KABSA WITH SAFFRON", nameAr: "كبسة لحم حاشي بلدي بالزعفران", meal: ["lunch", "dinner"], available: true },
            { id: "c2", nameEn: "TRADITIONAL SMOKED MANDI CHICKEN", nameAr: "دجاج مندي مدخن على الطريقة الأصلية", meal: ["lunch", "dinner"], available: true },
            { id: "c3", nameEn: "ROYAL MIXED CHARCOAL GRILL", nameAr: "مشاوي مشكلة فاخرة على الفحم", meal: ["lunch", "dinner"], available: true }
          ]
        },
        {
          id: "hot_dishes",
          nameEn: "ROYAL HOT BUFFET",
          nameAr: "أطباق البوفيه الساخن الملكي",
          theme: "gold",
          icon: `<path d="M12 23c-4.97 0-9-3.95-9-8.83 0-3.37 2.06-6.4 4.58-8.73.65-.6 1.7-.1 1.63.79-.18 2.22.75 4.34 2.45 5.56.24.18.59.04.66-.25.4-1.74 1.48-3.76 3.12-5.07.72-.57 1.79-.1 1.75.82-.12 2.68.82 5.3 2.53 7.15 1.57 1.7 2.28 3.5 2.28 5.56 0 4.88-4.03 8.83-9 8.83z"/>`,
          items: [
            { id: "h1", nameEn: "GRILLED HAMOUR WITH SAFFRON SAUCE", nameAr: "سمك هامور مشوي بصلصة الزعفران والليمون", meal: ["lunch", "dinner"], available: true },
            { id: "h2", nameEn: "TRADITIONAL ROYAL JAREESH", nameAr: "جريش قصيمي بالسمن البري والمسمنة", meal: ["breakfast", "lunch", "dinner"], available: true },
            { id: "h3", nameEn: "PESHAWAR RICE WITH NUTS & CARDAMOM", nameAr: "أرز بشاور فاخر بالهيل والمكسرات", meal: ["lunch", "dinner"], available: true },
            { id: "h4", nameEn: "OKRA STEW WITH TENDER VEAL", nameAr: "إيدام بامية بلحم العجل الطازج", meal: ["lunch", "dinner"], available: true },
            { id: "h5", nameEn: "FETTUCCINE ALFREDO WITH CHICKEN", nameAr: "مكرونة فوتوتشيني ألفريدو بالدجاج والفطر", meal: ["lunch", "dinner"], available: true },
            { id: "h6", nameEn: "ROYAL STUFFED VINE LEAVES & VEGGIES", nameAr: "محاشي مشكلة ملكية بدبس الرمان", meal: ["lunch", "dinner"], available: true }
          ]
        }
      ]
    };

    // Load initial data from localStorage with DEFAULT fallback
    let menuData = null;
    try {
      const stored = localStorage.getItem('alShurfaMenuData');
      if (stored) {
        menuData = JSON.parse(stored);
      }
    } catch(_e) {}
    if (!menuData || !menuData.categories || menuData.categories.length === 0) {
      menuData = JSON.parse(JSON.stringify(DEFAULT_DATA));
    }

    // BroadcastChannel for instant same-browser sync
    let syncChannel = null;
    try {
      syncChannel = new BroadcastChannel('al_shurfa_menu_sync');
      syncChannel.onmessage = (event) => {
        if (event.data && event.data.type === 'MENU_UPDATED' && event.data.payload) {
          applyMenuUpdate(event.data.payload);
        }
      };
    } catch(_e) {}

    // Cross-tab storage event
    window.addEventListener('storage', (e) => {
      if (e.key === 'alShurfaMenuData' && e.newValue) {
        try {
          const updated = JSON.parse(e.newValue);
          applyMenuUpdate(updated);
        } catch(_) {}
      }
    });

    // Socket.io Realtime Sync with Karim ERP Backend
    try {
      if (typeof io !== 'undefined') {
        const socket = io({ reconnectionAttempts: 10, timeout: 5000 });
        socket.on('connect', () => {
          console.log('[Menu] Socket connected to Karim ERP');
        });
        socket.on('buffet_menu_updated', (payload) => {
          if (payload) {applyMenuUpdate(payload);}
        });
        socket.on('entity_changed', () => {
          fetchBuffetData();
        });
        socket.on('menu_board_changed', () => {
          fetchBuffetData();
        });
      }
    } catch(err) {
      console.warn("Socket connect fallback:", err);
    }

    // Fetch live buffet data from backend
    async function fetchBuffetData() {
      try {
        const res = await fetch('/api/buffet-menu', { cache: 'no-store' });
        if (res.ok) {
          const json = await res.json();
          if (json && json.ok && json.data) {
            applyMenuUpdate(json.data);
            return;
          }
        }
      } catch(_) {}

      // Fallback check to menu-board settings for ticker/title
      try {
        const res2 = await fetch('/api/menu-board/public', { cache: 'no-store' });
        if (res2.ok) {
          const d2 = await res2.json();
          if (d2 && d2.settings) {
            if (d2.settings.title) {menuData.restaurant.nameAr = d2.settings.title;}
            if (d2.settings.footer_text) {menuData.restaurant.ticker = d2.settings.footer_text;}
            renderScreen();
          }
        }
      } catch(_) {}
    }

    // Apply update safely without breaking categories
    function applyMenuUpdate(newPayload) {
      if (!newPayload) {return;}
      if (newPayload.restaurant) {
        menuData.restaurant = Object.assign({}, menuData.restaurant, newPayload.restaurant);
      }
      if (newPayload.currentMeal) {menuData.currentMeal = newPayload.currentMeal;}
      if (newPayload.currentDay) {menuData.currentDay = newPayload.currentDay;}
      if (typeof newPayload.autoRotate === 'boolean') {menuData.autoRotate = newPayload.autoRotate;}

      // Only update categories if they contain non-empty data
      if (Array.isArray(newPayload.categories) && newPayload.categories.length > 0) {
        menuData.categories = newPayload.categories;
      }

      localStorage.setItem('alShurfaMenuData', JSON.stringify(menuData));
      renderScreen(true);
      triggerLiveFlash();
    }

    function triggerLiveFlash() {
      const el = document.getElementById('liveStatusText');
      if (el) {
        el.textContent = "تم التحديث!";
        el.classList.add('text-emerald-300');
        setTimeout(() => {
          el.textContent = "LIVE SYNC";
          el.classList.remove('text-emerald-300');
        }, 2000);
      }
    }

    // Clock
    function updateClock() {
      const now = new Date();
      const hrs = String(now.getHours()).padStart(2, '0');
      const mins = String(now.getMinutes()).padStart(2, '0');
      const clockEl = document.getElementById('screenClock');
      if (clockEl) {clockEl.textContent = `${hrs}:${mins}`;}
    }
    setInterval(updateClock, 1000);
    updateClock();

    // Meal Switcher
    function setMeal(meal) {
      menuData.currentMeal = meal;
      renderScreen();
      if (syncChannel) {
        syncChannel.postMessage({ type: 'MENU_UPDATED', payload: menuData });
      }
      localStorage.setItem('alShurfaMenuData', JSON.stringify(menuData));
    }

    // Fullscreen Toggle
    const fsBtn = document.getElementById('toggleFullscreenBtn');
    if (fsBtn) {
      fsBtn.addEventListener('click', () => {
        if (!document.fullscreenElement) {
          document.documentElement.requestFullscreen().catch(() => {});
        } else {
          document.exitFullscreen().catch(() => {});
        }
      });
    }

    // Auto-rotation timer
    let rotateTimer = null;
    function checkAutoRotate() {
      if (rotateTimer) {clearInterval(rotateTimer);}
      if (menuData.autoRotate) {
        const meals = ['breakfast', 'lunch', 'dinner'];
        rotateTimer = setInterval(() => {
          const curIdx = meals.indexOf(menuData.currentMeal);
          const nextIdx = (curIdx + 1) % meals.length;
          setMeal(meals[nextIdx]);
        }, (menuData.rotationIntervalSec || 25) * 1000);
      }
    }

    const mealNamesAr = {
      breakfast: "بوفيه الإفطار الملكي",
      lunch: "بوفيه الغداء الملكي",
      dinner: "بوفيه العشاء الملكي"
    };

    // Main Render Function
    function renderScreen(_isUpdate = false) {
      // Identity & Ticker
      document.getElementById('restaurantNameAr').textContent = menuData.restaurant.nameAr || "مطاعم الشرفة العالمي";
      document.getElementById('restaurantNameEn').textContent = menuData.restaurant.nameEn || "AL-SHURFA ROYAL OPEN BUFFET";
      document.getElementById('tickerText').textContent = menuData.restaurant.ticker || "";

      // Price Medallion
      const priceDisplay = document.getElementById('tickerPriceDisplay');
      const priceContainer = document.getElementById('priceBadgeContainer');
      if (priceDisplay && priceContainer) {
        if (menuData.restaurant.buffetPrice !== undefined && menuData.restaurant.buffetPrice !== null && menuData.restaurant.buffetPrice !== "") {
          priceDisplay.textContent = menuData.restaurant.buffetPrice;
          priceContainer.style.display = 'flex';
        } else {
          priceContainer.style.display = 'none';
        }
      }

      // Active Meal
      const activeMeal = menuData.currentMeal || "lunch";
      ['breakfast', 'lunch', 'dinner'].forEach(m => {
        const btn = document.getElementById(`mealBtn-${m}`);
        if (!btn) {return;}
        if (m === activeMeal) {
          btn.className = "badge-gold px-3.5 py-1 rounded-full text-slate-950 font-black text-[10.5px] uppercase shadow";
        } else {
          btn.className = "px-2.5 py-0.5 text-[10px] font-bold text-slate-300 rounded-full transition hover:text-white";
        }
      });

      document.getElementById('activeMealArabic').textContent = mealNamesAr[activeMeal] || "بوفيه مفتوح فاخر";

      // Active Day
      if (menuData.currentDay) {
        document.getElementById('activeDayEn').textContent = menuData.currentDay.en || "SUNDAY";
        document.getElementById('activeDayAr').textContent = menuData.currentDay.ar || "الأحد";
      }

      // Render Categories & Dishes
      const container = document.getElementById('menuCategoriesContainer');
      container.innerHTML = "";

      // Fallback categories if empty
      const categoriesToRender = (menuData.categories && menuData.categories.length > 0) 
        ? menuData.categories 
        : DEFAULT_DATA.categories;

      categoriesToRender.forEach((cat, _index) => {
        // Filter by availability and meal
        const visibleItems = (cat.items || []).filter(item => {
          if (item.available === false) {return false;}
          if (!item.meal || item.meal.length === 0) {return true;}
          return item.meal.includes(activeMeal);
        });

        // Even if 0 visible items in meal, show category with default items if desired
        const displayItems = visibleItems.length > 0 ? visibleItems : (cat.items || []);
        if (displayItems.length === 0) {return;}

        const itemsHtml = displayItems.map((item, itemIdx) => {
          const isNotLast = itemIdx < displayItems.length - 1;
          const divider = isNotLast ? "divider-gold-dots" : "";

          return `
            <div class="flex items-center justify-between py-1.5 ${divider} transition hover:bg-white/[0.02] px-1 rounded">
              <!-- Arabic Dish Name (Primary in Right-to-Left) -->
              <div class="w-7/12 text-right">
                <h3 class="text-xs sm:text-[13.5px] font-extrabold text-[#fff5cc] drop-shadow" style="font-family: 'Tajawal', sans-serif;">
                  ${item.nameAr}
                </h3>
              </div>
              <!-- English Dish Name -->
              <div class="w-5/12 text-left" dir="ltr">
                <p class="text-[10px] sm:text-[11px] font-bold text-amber-300/80 uppercase tracking-wide truncate" style="font-family: 'Outfit', sans-serif;">
                  ${item.nameEn || ''}
                </p>
              </div>
            </div>
          `;
        }).join('');

        const catHtml = `
          <section class="royal-glass rounded-2xl p-3 px-4 shadow-[0_4px_20px_rgba(0,0,0,0.5)]">
            <div class="corner-decor corner-tl"></div>
            <div class="corner-decor corner-tr"></div>
            
            <!-- Category Header -->
            <div class="flex items-center justify-between pb-2 mb-1 border-b border-amber-400/20">
              <div class="flex items-center gap-2">
                <div class="w-7 h-7 rounded-lg bg-amber-400/15 border border-amber-400/40 flex items-center justify-center text-amber-300 shadow">
                  <svg class="w-4 h-4 fill-current" viewBox="0 0 24 24">
                    ${cat.icon || DEFAULT_DATA.categories[0].icon}
                  </svg>
                </div>
                <h2 class="text-sm sm:text-base font-black text-gold-gradient" style="font-family: 'Tajawal', sans-serif;">
                  ${cat.nameAr}
                </h2>
              </div>
              <div dir="ltr">
                <span class="text-[10px] sm:text-[11px] font-extrabold text-amber-200/70 uppercase tracking-wider font-cinzel">
                  ${cat.nameEn}
                </span>
              </div>
            </div>

            <!-- Items List -->
            <div class="space-y-0.5">
              ${itemsHtml}
            </div>
          </section>
        `;

        container.insertAdjacentHTML('beforeend', catHtml);
      });
    }

    // Initial render & sync
    renderScreen();
    checkAutoRotate();
    fetchBuffetData();

    // Auto-poll every 30 seconds to keep updated
    setInterval(fetchBuffetData, 30000);
  