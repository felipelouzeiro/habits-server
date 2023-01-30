import { FastifyInstance } from 'fastify';
import dayjs from 'dayjs'; // biblioteca usada  para trabalhar com datas
import { z } from 'zod'; // biblioteca usada  para validações
import { prisma } from './lib/prisma';

export async function appRoutes(app: FastifyInstance) {
  app.post('/habits', async (req) => {
    const createHabitBody = z.object({
      title: z.string(),
      weekDays: z.array(z.number().min(0).max(6)),
    });

    const { title, weekDays } = createHabitBody.parse(req.body);

    const today = dayjs().startOf('day').toDate(); // retorna a data com horas zeradas

    await prisma.habit.create({
      data: {
        title,
        created_at: today,
        weekDays: {
          create: weekDays.map((weekDay) => {
            return {
              week_day: weekDay,
            };
          }),
        },
      },
    });
  });

  app.get('/day', async (req) => {
    const getDayParams = z.object({
      date: z.coerce.date(), //converte a string data em data
    });

    const { date } = getDayParams.parse(req.query);

    const parsedDate = dayjs(date).startOf('day');
    const week_day = parsedDate.get('day');

    const possibleHabits = await prisma.habit.findMany({
      where: {
        created_at: { lte: date },
        weekDays: { some: { week_day: week_day } },
      },
    });

    const day = await prisma.day.findUnique({
      where: {
        date: parsedDate.toDate(),
      },
      include: { dayHabits: true },
    });

    const completedHabits = day?.dayHabits.map((dayHabit) => dayHabit.habit_id);

    return {
      possibleHabits,
      completedHabits,
    };
  });

  app.patch('/habits/:id/toggle', async (req) => {
    const toggleHabitParams = z.object({
      id: z.string().uuid(),
    });

    const { id } = toggleHabitParams.parse(req.params);

    const today = dayjs().startOf('day').toDate();

    let day = await prisma.day.findUnique({
      where: { date: today },
    });

    if (!day) {
      day = await prisma.day.create({
        data: {
          date: today,
        },
      });
    }

    // buscando se o hábito já está completo
    const dayHabit = await prisma.dayHabit.findUnique({
      where: {
        day_id_habit_id: {
          day_id: day.id,
          habit_id: id,
        },
      },
    });

    if (dayHabit) {
      await prisma.dayHabit.delete({
        where: { id: dayHabit.id },
      });
    } else {
      // completa hábito nesse dia
      await prisma.dayHabit.create({
        data: {
          day_id: day.id,
          habit_id: id,
        },
      });
    }
  });

  app.get('/summary', async () => {
    const summary = await prisma.$queryRaw`
    SELECT 
      D.id,  
      D.date,
    (
      SELECT 
        cast(count(*) as float)
      FROM day_habits DH
      WHERE DH.day_id = D.id
    ) as completed,
    (
      SELECT 
        cast(count(*) as float)
      FROM habit_week_days HWD
      JOIN habits H
        ON H.id = HWD.habit_id
      WHERE HWD.week_day = cast(strftime('%w', D.date/1000.0, 'unixepoch') as int)
        AND H.created_at <= D.date
    ) as amount
    FROM days D
    `;

    return summary;
  });
}
