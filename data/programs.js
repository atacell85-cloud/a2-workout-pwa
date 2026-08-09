export const A2_PROGRAM = {
  id: 'a2',
  name: 'A2 Antrenman',
  workoutDays: [
    {
      id: 'upper',
      label: 'Pazartesi • Upper',
      sections: [
        {
          id: 'upper-scapula',
          name: 'SCAPULA HAZIRLIK',
          type: 'activation',
          exercises: [
            exercise('serratus-wall-slide', 'Serratus Wall Slide', '1 x 8-12', 'activation'),
            exercise('scapular-push-up-plus', 'Scapular Push-up / Push-up Plus', '1 x 8-12', 'activation'),
            exercise('prone-y-cable-y-raise', 'Prone Y / Cable Y Raise', '1 x 8-12', 'activation'),
            exercise('scapular-pull-up-active-hang', 'Scapular Pull-up / Active Hang', '1 x 5-8', 'activation')
          ]
        },
        {
          id: 'upper-main',
          name: 'ANTRENMAN',
          type: 'strength',
          exercises: [
            exercise('machine-fly-warmup', 'Machine Fly – Isınma', '1 x 12', 'warmup'),
            exercise('machine-fly-work', 'Machine Fly – Work', '2 x 12', 'working'),
            exercise('incline-smith-press-warmup', 'Incline Smith Press – Isınma', '2 set', 'warmup'),
            exercise('incline-smith-press-work', 'Incline Smith Press – Work', '2 x 8-10', 'working'),
            exercise('lat-pulldown', 'Lat Pulldown', '4 x 10', 'working'),
            exercise('wide-grip-row', 'Wide Grip Row', '3 x 12', 'working'),
            exercise('lateral-raise', 'Lateral Raise', '3 x 15', 'working'),
            exercise('face-pull', 'Face Pull', '3 x 15', 'working'),
            exercise('barbell-curl', 'Barbell Curl', '3 x 10', 'working'),
            exercise('rope-pushdown', 'Rope Pushdown', '3 x 12', 'working')
          ]
        },
        {
          id: 'upper-stretch',
          name: 'STRETCH',
          type: 'stretch',
          exercises: [
            exercise('doorway-chest-stretch', 'Doorway Chest Stretch', '3 x 30-40 sn', 'stretch'),
            exercise('childs-pose-lat-stretch', 'Child’s Pose Lat Stretch', '2 x 30-40 sn', 'stretch')
          ]
        }
      ]
    },
    {
      id: 'lower',
      label: 'Salı • Lower',
      sections: [
        {
          id: 'lower-main',
          name: 'ANTRENMAN',
          type: 'strength',
          exercises: [
            exercise('lying-leg-curl', 'Lying Leg Curl', '3 x 15', 'working'),
            exercise('leg-extension', 'Leg Extension', '3 x 12', 'working'),
            exercise('hip-adduction', 'Hip Adduction', '3 x 15', 'working'),
            exercise('hip-abduction', 'Hip Abduction', '3 x 15', 'working'),
            exercise('glute-bridge', 'Glute Bridge', '3 x 15', 'working'),
            exercise('standing-calf-raise', 'Standing Calf Raise', '5 x 20', 'working')
          ]
        },
        {
          id: 'lower-core',
          name: 'CORE',
          type: 'core',
          exercises: [
            exercise('weighted-crunch', 'Weighted Crunch', '3 x 15', 'core'),
            exercise('reverse-crunch', 'Reverse Crunch', '3 x 15', 'core')
          ]
        },
        {
          id: 'lower-stretch',
          name: 'STRETCH',
          type: 'stretch',
          exercises: [
            exercise('standing-quadriceps-stretch', 'Standing Quadriceps Stretch', '2 x 30-40 sn', 'stretch'),
            exercise('standing-hamstring-stretch', 'Standing Hamstring Stretch', '2 x 30-40 sn', 'stretch')
          ]
        }
      ]
    },
    {
      id: 'push',
      label: 'Perşembe • Push',
      sections: [
        {
          id: 'push-scapula',
          name: 'SCAPULA HAZIRLIK',
          type: 'activation',
          exercises: [
            exercise('serratus-wall-slide', 'Serratus Wall Slide', '1 x 8-12', 'activation'),
            exercise('scapular-push-up-plus', 'Scapular Push-up / Push-up Plus', '1 x 8-12', 'activation'),
            exercise('prone-y-cable-y-raise', 'Prone Y / Cable Y Raise', '1 x 8-12', 'activation')
          ]
        },
        {
          id: 'push-main',
          name: 'ANTRENMAN',
          type: 'strength',
          exercises: [
            exercise('machine-fly-warmup', 'Machine Fly – Isınma', '1 x 12', 'warmup'),
            exercise('machine-fly-work', 'Machine Fly – Work', '2 x 12', 'working'),
            exercise('incline-chest-machine', 'Incline Chest Machine', '3 x 12', 'working'),
            exercise('cable-crossover', 'Cable Crossover', '3 x 15', 'working'),
            exercise('machine-shoulder-press', 'Machine Shoulder Press', '3 x 12', 'working'),
            exercise('cable-lateral-raise', 'Cable Lateral Raise', '4 x 15', 'working'),
            exercise('lying-triceps-extension', 'Lying Triceps Extension', '3 x 12', 'working'),
            exercise('rope-pushdown', 'Rope Pushdown', '3 x 12', 'working')
          ]
        },
        {
          id: 'push-stretch',
          name: 'STRETCH',
          type: 'stretch',
          exercises: [
            exercise('doorway-chest-stretch', 'Doorway Chest Stretch', '3 x 30-40 sn', 'stretch'),
            exercise('overhead-triceps-stretch', 'Overhead Triceps Stretch', '3 x 30-40 sn', 'stretch')
          ]
        }
      ]
    },
    {
      id: 'pull',
      label: 'Cuma • Pull',
      sections: [
        {
          id: 'pull-scapula',
          name: 'SCAPULA HAZIRLIK',
          type: 'activation',
          exercises: [
            exercise('serratus-wall-slide', 'Serratus Wall Slide', '1 x 8-12', 'activation'),
            exercise('prone-y-cable-y-raise', 'Prone Y / Cable Y Raise', '1 x 8-12', 'activation'),
            exercise('scapular-pull-up-active-hang', 'Scapular Pull-up / Active Hang', '1 x 5-8', 'activation')
          ]
        },
        {
          id: 'pull-main',
          name: 'ANTRENMAN',
          type: 'strength',
          exercises: [
            exercise('reverse-grip-pulldown', 'Reverse Grip Pulldown', '3 x 12', 'working'),
            exercise('chest-supported-row-warmup', 'Chest Supported Row – Isınma', '2 set', 'warmup'),
            exercise('chest-supported-row-work', 'Chest Supported Row – Work', '2 x 12', 'working'),
            exercise('seated-cable-row', 'Seated Cable Row', '3 x 12', 'working'),
            exercise('rear-delt-fly', 'Rear Delt Fly', '3 x 15', 'working'),
            exercise('hammer-curl', 'Hammer Curl', '3 x 10', 'working'),
            exercise('incline-dumbbell-curl', 'Incline Dumbbell Curl', '2 x 12', 'working')
          ]
        },
        {
          id: 'pull-core',
          name: 'CORE',
          type: 'core',
          exercises: [
            exercise('weighted-crunch', 'Weighted Crunch', '3 x 15', 'core'),
            exercise('reverse-crunch', 'Reverse Crunch', '3 x 15', 'core')
          ]
        },
        {
          id: 'pull-stretch',
          name: 'STRETCH',
          type: 'stretch',
          exercises: [
            exercise('wall-lat-stretch', 'Wall Lat Stretch', '2 x 30-40 sn', 'stretch'),
            exercise('childs-pose-lat-stretch', 'Child’s Pose Lat Stretch', '2 x 30-40 sn', 'stretch')
          ]
        }
      ]
    }
  ]
};

export const PROGRAMS = [A2_PROGRAM];

export function findProgram(programId = 'a2') {
  return PROGRAMS.find(program => program.id === programId) || A2_PROGRAM;
}

export function findWorkoutDay(programId, workoutDayId) {
  return findProgram(programId).workoutDays.find(day => day.id === workoutDayId);
}

export function allExercises(programId = 'a2') {
  return findProgram(programId).workoutDays.flatMap(day =>
    day.sections.flatMap(section =>
      section.exercises.map(item => ({ ...item, workoutDayId: day.id, sectionId: section.id, sectionType: section.type }))
    )
  );
}

export function findExercise(exerciseId, programId = 'a2') {
  return allExercises(programId).find(exercise => exercise.id === exerciseId);
}

export function exercisesForDay(programId, workoutDayId) {
  const day = findWorkoutDay(programId, workoutDayId);
  return day ? day.sections.flatMap(section => section.exercises.map(item => ({ ...item, sectionId: section.id, sectionType: section.type }))) : [];
}

function exercise(id, name, prescriptionText, setType) {
  return {
    id,
    name,
    setType,
    prescription: {
      text: prescriptionText,
      plannedSets: parseSetCount(prescriptionText)
    }
  };
}

function parseSetCount(text) {
  const match = text.match(/^(\d+)\s*(?:x|set)/i);
  return match ? Number(match[1]) : 1;
}
